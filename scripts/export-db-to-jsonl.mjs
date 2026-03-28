#!/usr/bin/env node
/**
 * Export libSQL brain.db → brain.jsonl (for HTML viewer compatibility)
 *
 * Usage: node scripts/export-db-to-jsonl.mjs [db-path] [output-path]
 * Defaults: data/brain.db → data/brain.jsonl
 */

import { createClient } from '../mcp-memory-libsql/node_modules/@libsql/client/lib-esm/node.js';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const dbPath = process.argv[2] || join(root, 'data', 'brain.db');
const outPath = process.argv[3] || join(root, 'data', 'brain.jsonl');

if (!existsSync(dbPath)) {
  console.error('DB not found:', dbPath);
  process.exit(1);
}

const db = createClient({ url: `file:${dbPath}` });

// Load entities (skip archived/merged)
const entities = await db.execute(
  'SELECT name, entity_type, created_at FROM entities WHERE archived = 0 AND merged = 0'
);

// Load observations grouped by entity
const observations = await db.execute(
  'SELECT entity_name, content, confidence, created_at FROM observations ORDER BY entity_name, id'
);

// Load relations
const relations = await db.execute(
  'SELECT source_id, target_id, relation_type FROM relations'
);

// Group observations by entity name
const obsMap = new Map();
for (const row of observations.rows) {
  const name = row.entity_name;
  if (!obsMap.has(name)) obsMap.set(name, []);
  obsMap.get(name).push(row.content);
}

// Build JSONL lines
const lines = [];

for (const row of entities.rows) {
  lines.push(JSON.stringify({
    type: 'entity',
    name: row.name,
    entityType: row.entity_type,
    observations: obsMap.get(row.name) || []
  }));
}

for (const row of relations.rows) {
  lines.push(JSON.stringify({
    type: 'relation',
    from: row.source_id,
    to: row.target_id,
    relationType: row.relation_type
  }));
}

writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
db.close();

const entityCount = entities.rows.length;
const relCount = relations.rows.length;
const obsCount = observations.rows.length;
console.log(`Exported ${entityCount} entities (${obsCount} observations) + ${relCount} relations → ${outPath}`);
