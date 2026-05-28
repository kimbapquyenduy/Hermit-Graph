#!/usr/bin/env node
/**
 * migrate-embeddings-to-vec.mjs — Backfill vec_entities table from existing JSONL vault.
 *
 * Reads entities from brain.jsonl (or a custom path), embeds each entity's
 * observations using Xenova/all-MiniLM-L6-v2, and upserts into vec_entities.
 * Idempotent: re-running updates existing rows.
 *
 * Usage:
 *   node scripts/migrate-embeddings-to-vec.mjs [options]
 *   hermit-migrate-vec [options]
 *
 * Options:
 *   --db <path>          Path to brain.db (default: data/brain.db)
 *   --from-jsonl <path>  Source JSONL to embed from (default: data/brain.jsonl)
 *   --from-cache <path>  Load pre-computed embedding cache (JSON: { name: number[] })
 *   --dry-run            Parse + validate only, no writes
 *   --batch <n>          Upsert batch size (default: 100)
 */

import { createReadStream, existsSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import * as sqliteVec from 'sqlite-vec';
import { SqliteVecBackend } from './lib/memory/sqlite-vec-adapter.mjs';
import { embed } from './lib/embedding-service.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);

const EMBEDDING_DIM = 384;

// ── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    db: join(PROJECT_ROOT, 'data', 'brain.db'),
    fromJsonl: join(PROJECT_ROOT, 'data', 'brain.jsonl'),
    fromCache: null,
    dryRun: false,
    batch: 100,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db') opts.db = args[++i];
    else if (args[i] === '--from-jsonl') opts.fromJsonl = args[++i];
    else if (args[i] === '--from-cache') opts.fromCache = args[++i];
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--batch') opts.batch = parseInt(args[++i], 10) || 100;
  }
  return opts;
}

// ── Load pre-computed cache ──────────────────────────────────────────────────

/**
 * Attempt to load an embedding cache file.
 * Expected format: { "EntityName": [f0, f1, ..., f383] }
 * @param {string} cachePath
 * @returns {Map<string, Float32Array>|null} null if format unreadable
 */
function loadCache(cachePath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(cachePath, 'utf8'));
  } catch (err) {
    console.error(`[migrate-vec] Cannot read cache: ${err.message}`);
    return null;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    console.error('[migrate-vec] Cache format unrecognised — expected { name: number[] }');
    return null;
  }
  const map = new Map();
  for (const [name, arr] of Object.entries(raw)) {
    if (!Array.isArray(arr) || arr.length !== EMBEDDING_DIM) {
      console.error(`[migrate-vec] Cache dim mismatch for "${name}": expected ${EMBEDDING_DIM}, got ${arr?.length}. Use --force to re-embed.`);
      return null;
    }
    map.set(name, new Float32Array(arr));
  }
  return map;
}

// ── Stream entities from JSONL ───────────────────────────────────────────────

async function* streamEntities(jsonlPath) {
  const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.type === 'entity' && obj.name) yield obj;
    } catch { /* skip malformed lines */ }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  console.log('[migrate-vec] Starting embed migration...');
  console.log(`  db       : ${opts.db}`);
  console.log(`  from     : ${opts.fromCache || opts.fromJsonl}`);
  console.log(`  dry-run  : ${opts.dryRun}`);
  console.log(`  batch    : ${opts.batch}`);

  // ── Dry-run fast path: count only, skip model load entirely ──
  if (opts.dryRun) {
    const jsonlSrc = opts.fromJsonl;
    if (!existsSync(jsonlSrc)) {
      console.error(`[migrate-vec] brain.jsonl not found for dry-run count: ${jsonlSrc}`);
      process.exit(1);
    }
    let count = 0;
    for await (const _entity of streamEntities(jsonlSrc)) count++;
    console.log(`[migrate-vec] Dry-run: ${count} entities would be embedded. No writes performed.`);
    return;
  }

  if (!existsSync(opts.db)) {
    console.error(`[migrate-vec] brain.db not found: ${opts.db}`);
    process.exit(1);
  }
  if (!existsSync(opts.fromJsonl) && !opts.fromCache) {
    console.error(`[migrate-vec] brain.jsonl not found: ${opts.fromJsonl}`);
    process.exit(1);
  }

  // Open DB and load extension.
  const Database = require('better-sqlite3');
  const db = Database(opts.db);
  db.pragma('journal_mode = WAL');
  sqliteVec.load(db);

  const backend = new SqliteVecBackend({ db });

  // Optionally load pre-computed cache.
  let cache = null;
  if (opts.fromCache) {
    if (!existsSync(opts.fromCache)) {
      console.error(`[migrate-vec] Cache file not found: ${opts.fromCache}`);
      process.exit(1);
    }
    cache = loadCache(opts.fromCache);
    if (!cache) {
      console.error('[migrate-vec] Cache load failed — aborting. Re-run without --from-cache to embed from JSONL.');
      process.exit(1);
    }
    console.log(`[migrate-vec] Loaded ${cache.size} cached embeddings.`);
  }

  let processed = 0;
  let batch = [];

  async function flushBatch() {
    if (batch.length === 0) return;
    await backend.upsertBatch(batch);
    batch = [];
  }

  for await (const entity of streamEntities(opts.fromJsonl)) {
    let vec;
    if (cache && cache.has(entity.name)) {
      vec = cache.get(entity.name);
    } else {
      const obsText = (entity.observations || [])
        .map(o => (typeof o === 'string' ? o : (o.content || '')))
        .join('\n');
      const text = `${entity.name}\n${obsText}`.trim();
      vec = await embed(text);
      if (!vec) {
        console.warn(`[migrate-vec] Embed returned null for "${entity.name}" — skipping`);
        continue;
      }
    }
    batch.push([entity.name, vec]);
    processed++;
    if (batch.length >= opts.batch) await flushBatch();
    if (processed % 100 === 0) process.stdout.write(`\r  processed: ${processed}`);
  }
  await flushBatch();
  process.stdout.write('\n');

  const finalCount = await backend.count();
  console.log(`[migrate-vec] Done. Entities processed: ${processed}. vec_entities rows: ${finalCount}`);

  if (typeof finalCount === 'number' && finalCount < processed) {
    console.warn(`[migrate-vec] Warning: vec count (${finalCount}) < processed (${processed}). Some upserts may have failed.`);
  }
  db.close();
}

main().catch(err => {
  console.error('[migrate-vec] Fatal:', err.message);
  process.exit(1);
});
