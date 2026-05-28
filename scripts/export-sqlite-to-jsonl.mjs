#!/usr/bin/env node
/**
 * export-sqlite-to-jsonl.mjs — Inverse export: brain.db → brain.jsonl format.
 * Useful for disaster recovery and round-trip verification.
 * SELECT all entities + relations → write JSONL.
 *
 * Usage:
 *   node scripts/export-sqlite-to-jsonl.mjs [options]
 *
 * Options:
 *   --db <path>    Source SQLite DB (default: data/brain.db)
 *   --to <path>    Output JSONL path (default: data/brain.jsonl.exported)
 *   --verbose      Log progress
 */

import { existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SqliteProvider } from './lib/memory/sqlite-backend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
function flag(name) { return args.includes(name); }

const dbPath  = opt('--db',  join(ROOT, 'data', 'brain.db'));
const outPath = opt('--to',  join(ROOT, 'data', 'brain.jsonl.exported'));
const verbose = flag('--verbose');

// ── Validation ───────────────────────────────────────────────────────────────

if (!existsSync(dbPath)) {
  console.error(`Error: DB file not found: ${dbPath}`);
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`hermit-export: ${dbPath} → ${outPath}`);

  const provider = new SqliteProvider({ dbPath });
  const { entities, relations } = await provider.readAll();

  const lines = [];

  for (const [, entity] of entities) {
    lines.push(JSON.stringify({
      type: 'entity',
      name: entity.name,
      entityType: entity.entityType,
      observations: entity.observations || [],
    }));
    if (verbose) console.log(`  entity: ${entity.name}`);
  }

  for (const rel of relations) {
    lines.push(JSON.stringify({
      type: 'relation',
      from: rel.from,
      to: rel.to,
      relationType: rel.relationType,
    }));
    if (verbose) console.log(`  relation: ${rel.from} -[${rel.relationType}]-> ${rel.to}`);
  }

  writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
  provider.close();

  console.log(`Exported ${entities.size} entities + ${relations.length} relations → ${outPath}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
