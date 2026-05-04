#!/usr/bin/env node
/**
 * sqlite-vec-write.test.mjs — Write-path tests for SqliteVecBackend.
 * Covers: upsert 100 entities, count, update, delete, validation errors.
 *
 * Run: node test/sqlite-vec-write.test.mjs
 */

import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import * as sqliteVec from 'sqlite-vec';
import { SqliteVecBackend } from '../scripts/lib/memory/sqlite-vec-adapter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '..', 'tmp', 'sqlite-vec-write-test');
const require = createRequire(import.meta.url);

const DIMS = 384;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
}

// ── Deterministic vector generation ─────────────────────────────────────────

function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s |= 0;
    s = s + 0x6d2b79f5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeVec(seed) {
  const rng = mulberry32(seed);
  return Float32Array.from({ length: DIMS }, () => rng() * 2 - 1);
}

// ── DB factory ───────────────────────────────────────────────────────────────

function openDb(name) {
  const Database = require('better-sqlite3');
  const db = Database(join(TMP, name));
  db.pragma('journal_mode = WAL');
  sqliteVec.load(db);
  // Create meta table (normally owned by SqliteProvider schema)
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  return db;
}

// ── Setup ────────────────────────────────────────────────────────────────────

if (existsSync(TMP)) rmSync(TMP, { recursive: true });
mkdirSync(TMP, { recursive: true });

// ── Suite: upsert 100 entities ───────────────────────────────────────────────

console.log('\nupsert-100');

await test('upsert 100 distinct entities → count === 100', async () => {
  const db = openDb('upsert-100.db');
  const backend = new SqliteVecBackend({ db });

  for (let i = 0; i < 100; i++) {
    await backend.upsert(`TECH:Entity${i}`, makeVec(i));
  }

  const n = await backend.count();
  assert(n === 100, `Expected 100, got ${n}`);
  db.close();
});

await test('upsert same name twice → count stays 100 (delete+insert emulated upsert)', async () => {
  const db = openDb('upsert-replace.db');
  const backend = new SqliteVecBackend({ db });

  for (let i = 0; i < 100; i++) {
    await backend.upsert(`TECH:Entity${i}`, makeVec(i));
  }
  // Update entity 0 with a different vector — should not increase count
  const newVec = makeVec(9999);
  await backend.upsert('TECH:Entity0', newVec);

  const n = await backend.count();
  assert(n === 100, `Count should still be 100 after update, got ${n}`);

  // Confirm entity still present (vec0 does not expose raw read of embedding bytes
  // in all versions — just confirm it exists via count query)
  const row = db.prepare(`SELECT name FROM vec_entities WHERE name = 'TECH:Entity0'`).get();
  assert(row && row.name === 'TECH:Entity0', 'Updated entity should still exist');
  db.close();
});

// ── Suite: delete ────────────────────────────────────────────────────────────

console.log('\ndelete');

await test('delete one entity → count === 99', async () => {
  const db = openDb('delete-one.db');
  const backend = new SqliteVecBackend({ db });

  for (let i = 0; i < 100; i++) {
    await backend.upsert(`TECH:Entity${i}`, makeVec(i));
  }
  await backend.delete('TECH:Entity42');

  const n = await backend.count();
  assert(n === 99, `Expected 99 after delete, got ${n}`);

  const row = db.prepare('SELECT name FROM vec_entities WHERE name = ?').get('TECH:Entity42');
  assert(!row, 'Deleted entity should not exist in table');
  db.close();
});

await test('delete non-existent name → no error, count unchanged', async () => {
  const db = openDb('delete-noop.db');
  const backend = new SqliteVecBackend({ db });
  await backend.upsert('TECH:EntityA', makeVec(1));
  await backend.delete('TECH:NonExistent');
  const n = await backend.count();
  assert(n === 1, `Expected 1, got ${n}`);
  db.close();
});

// ── Suite: validation ────────────────────────────────────────────────────────

console.log('\nvalidation');

await test('wrong dim vector throws', async () => {
  const db = openDb('validate-dim.db');
  const backend = new SqliteVecBackend({ db });
  let threw = false;
  try {
    await backend.upsert('TECH:Bad', new Float32Array(100)); // wrong dim
  } catch (e) {
    threw = true;
    assert(e.message.includes('384'), `Error should mention dim 384, got: ${e.message}`);
  }
  assert(threw, 'Should throw on wrong dim');
  db.close();
});

await test('non-Float32Array throws', async () => {
  const db = openDb('validate-type.db');
  const backend = new SqliteVecBackend({ db });
  let threw = false;
  try {
    await backend.upsert('TECH:Bad', Array.from({ length: DIMS }, () => 0));
  } catch (e) {
    threw = true;
    assert(e.message.includes('Float32Array'), `Error should mention Float32Array, got: ${e.message}`);
  }
  assert(threw, 'Should throw on non-Float32Array');
  db.close();
});

await test('vector with NaN throws', async () => {
  const db = openDb('validate-nan.db');
  const backend = new SqliteVecBackend({ db });
  const badVec = makeVec(1);
  badVec[0] = NaN;
  let threw = false;
  try {
    await backend.upsert('TECH:Bad', badVec);
  } catch (e) {
    threw = true;
    assert(e.message.toLowerCase().includes('finite') || e.message.toLowerCase().includes('nan'),
      `Error should mention finite/NaN, got: ${e.message}`);
  }
  assert(threw, 'Should throw on NaN value');
  db.close();
});

await test('missing name throws', async () => {
  const db = openDb('validate-name.db');
  const backend = new SqliteVecBackend({ db });
  let threw = false;
  try {
    await backend.upsert('', makeVec(1));
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Should throw on empty name');
  db.close();
});

// ── Suite: upsertBatch ───────────────────────────────────────────────────────

console.log('\nupsertBatch');

await test('upsertBatch 50 pairs → count === 50', async () => {
  const db = openDb('batch-50.db');
  const backend = new SqliteVecBackend({ db });
  const pairs = Array.from({ length: 50 }, (_, i) => [`BATCH:Entity${i}`, makeVec(i + 200)]);
  await backend.upsertBatch(pairs);
  const n = await backend.count();
  assert(n === 50, `Expected 50, got ${n}`);
  db.close();
});

await test('upsertBatch empty array → no-op', async () => {
  const db = openDb('batch-empty.db');
  const backend = new SqliteVecBackend({ db });
  await backend.upsertBatch([]);
  const n = await backend.count();
  assert(n === 0, `Expected 0, got ${n}`);
  db.close();
});

// ── Suite: search throws (phase 03c) ────────────────────────────────────────

console.log('\nsearch-stub');

await test('search() throws "Phase 03c" error', async () => {
  const db = openDb('search-stub.db');
  const backend = new SqliteVecBackend({ db });
  let threw = false;
  try {
    await backend.search(makeVec(1), 5);
  } catch (e) {
    threw = true;
    assert(e.message.includes('03c'), `Error should mention 03c, got: ${e.message}`);
  }
  assert(threw, 'search() should throw until 03c');
  db.close();
});

// ── Suite: meta table seeded ─────────────────────────────────────────────────

console.log('\nmeta-seeding');

await test('constructor seeds embedding_dim + embedding_model in meta', async () => {
  const db = openDb('meta-seed.db');
  new SqliteVecBackend({ db });
  const dim = db.prepare(`SELECT value FROM meta WHERE key='embedding_dim'`).get();
  const model = db.prepare(`SELECT value FROM meta WHERE key='embedding_model'`).get();
  assert(dim && dim.value === '384', `embedding_dim should be '384', got: ${dim?.value}`);
  assert(model && model.value.includes('MiniLM'), `embedding_model should include MiniLM, got: ${model?.value}`);
  db.close();
});

// ── Suite: capabilities ──────────────────────────────────────────────────────

console.log('\ncapabilities');

await test('capabilities() returns expected shape', async () => {
  const db = openDb('caps.db');
  const backend = new SqliteVecBackend({ db });
  const caps = backend.capabilities();
  assert(caps.vector === 'sqlite-vec', `vector should be 'sqlite-vec', got: ${caps.vector}`);
  assert(caps.dim === 384, `dim should be 384, got: ${caps.dim}`);
  assert(caps.searchAvailable === false, 'searchAvailable should be false in 03b');
  db.close();
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

// Windows: WAL/SHM files may linger briefly; best-effort cleanup.
try {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
} catch (_e) { /* non-fatal — tmp files cleaned on next run */ }

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
