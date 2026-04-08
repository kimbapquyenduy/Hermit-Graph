#!/usr/bin/env node
/**
 * Build embedding index from brain.jsonl.
 * For each entity, embeds: "name | entityType | top observations"
 * Saves to data/brain-embeddings.json with hash-based staleness detection.
 *
 * Usage: node scripts/build-embedding-index.mjs [--force]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { embed, isAvailable, MODEL_ID } from './lib/embedding-service.mjs';
import { obsText } from './lib/parse-observation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const BRAIN_PATH = join(PROJECT_ROOT, 'data', 'brain.jsonl');
const INDEX_PATH = join(PROJECT_ROOT, 'data', 'brain-embeddings.json');

const MAX_OBS_PER_ENTITY = 5; // Top N observations to include in embedding text

/**
 * Create a content hash for an entity (name + type + observations).
 * Used to detect if entity content changed since last index build.
 */
function entityHash(entity) {
  const parts = [entity.name, entity.entityType, ...(entity.observations || []).map(o => obsText(o))];
  return createHash('md5').update(parts.join('|')).digest('hex').slice(0, 12);
}

/**
 * Build text representation of an entity for embedding.
 * Format: "EntityName | entityType | obs1 | obs2 | ..."
 */
function entityToText(entity) {
  const obs = (entity.observations || [])
    .map(o => obsText(o))
    .filter(Boolean)
    .slice(0, MAX_OBS_PER_ENTITY);
  return [entity.name, entity.entityType, ...obs].join(' | ');
}

/**
 * Load existing index for incremental updates.
 */
function loadExistingIndex() {
  if (!existsSync(INDEX_PATH)) return null;
  try {
    return JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  } catch { return null; }
}

/**
 * Parse brain.jsonl into entities array.
 */
function loadEntities() {
  if (!existsSync(BRAIN_PATH)) {
    console.error('brain.jsonl not found at:', BRAIN_PATH);
    process.exit(1);
  }
  const lines = readFileSync(BRAIN_PATH, 'utf-8').split('\n').filter(Boolean);
  const entities = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'entity') entities.push(obj);
    } catch { /* skip malformed lines */ }
  }
  return entities;
}

async function main() {
  const forceRebuild = process.argv.includes('--force');

  console.log('=== Build Embedding Index ===\n');

  // Check model availability
  const available = await isAvailable();
  if (!available) {
    console.error('Embedding model not available. Run: npm run setup:semantic');
    process.exit(1);
  }

  // Load entities
  const entities = loadEntities();
  console.log(`Found ${entities.length} entities in brain.jsonl`);

  // Load existing index for incremental update
  const existing = forceRebuild ? null : loadExistingIndex();
  const existingEntities = existing?.entities || {};

  // Determine which entities need (re-)embedding
  let toEmbed = [];
  let skipped = 0;
  for (const entity of entities) {
    const hash = entityHash(entity);
    if (!forceRebuild && existingEntities[entity.name]?.hash === hash) {
      skipped++;
    } else {
      toEmbed.push({ entity, hash });
    }
  }

  console.log(`To embed: ${toEmbed.length} | Unchanged (skip): ${skipped}`);

  if (toEmbed.length === 0) {
    console.log('\nIndex is up to date. Use --force to rebuild all.');
    return;
  }

  // Build embeddings
  const startTime = Date.now();
  const newEntities = { ...existingEntities };

  for (let i = 0; i < toEmbed.length; i++) {
    const { entity, hash } = toEmbed[i];
    const text = entityToText(entity);
    const vector = await embed(text);

    if (!vector) {
      console.error(`Failed to embed: ${entity.name}`);
      continue;
    }

    newEntities[entity.name] = {
      vector: Array.from(vector), // JSON-serializable
      hash,
      entityType: entity.entityType,
    };

    // Progress indicator
    if ((i + 1) % 25 === 0 || i === toEmbed.length - 1) {
      const pct = Math.round(((i + 1) / toEmbed.length) * 100);
      process.stdout.write(`\r  Embedding: ${i + 1}/${toEmbed.length} (${pct}%)`);
    }
  }
  console.log(); // newline after progress

  // Remove entities that no longer exist in brain.jsonl
  const currentNames = new Set(entities.map(e => e.name));
  for (const name of Object.keys(newEntities)) {
    if (!currentNames.has(name)) {
      delete newEntities[name];
    }
  }

  // Save index
  const index = {
    meta: {
      model: MODEL_ID,
      builtAt: new Date().toISOString(),
      entityCount: Object.keys(newEntities).length,
      dimensions: 384,
    },
    entities: newEntities,
  };

  writeFileSync(INDEX_PATH, JSON.stringify(index), 'utf-8');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const sizeMB = (Buffer.byteLength(JSON.stringify(index)) / 1048576).toFixed(1);

  console.log(`\nDone in ${elapsed}s`);
  console.log(`Index: ${Object.keys(newEntities).length} entities, ${sizeMB}MB`);
  console.log(`Saved to: ${INDEX_PATH}`);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
