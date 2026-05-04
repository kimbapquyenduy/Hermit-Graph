#!/usr/bin/env node
/**
 * vector-backend-latency.test.mjs — p50/p95 search latency for SqliteVecBackend + BruteForceVectorBackend.
 *
 * 5k-vector fixture (deterministic). 50 queries per backend.
 * Assert: SqliteVecBackend p95 <= 100ms.
 * BruteForce p95 recorded for reference — not asserted.
 *
 * Run: node test/vector-backend-latency.test.mjs
 */

import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import * as sqliteVec from 'sqlite-vec';
import { SqliteVecBackend } from '../scripts/lib/memory/sqlite-vec-adapter.mjs';
import { BruteForceVectorBackend } from '../scripts/lib/memory/brute-force-vector-fallback.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '..', 'tmp', 'vector-backend-latency-test');
const require = createRequire(import.meta.url);

const DIMS = 384;
const FIXTURE_SIZE = 5000;
const QUERY_COUNT = 50;
const TOP_K = 10;
const SQLITE_P95_LIMIT_MS = 100;

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}: ${e.message}`); }
}

// ── Deterministic PRNG ───────────────────────────────────────────────────────

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = s + 0x6d2b79f5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNormalizedVec(seed) {
  const rng = mulberry32(seed);
  const v = Float32Array.from({ length: DIMS }, () => rng() * 2 - 1);
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

// ── Percentile helper ────────────────────────────────────────────────────────

/**
 * Compute percentile from sorted array of numbers.
 * @param {number[]} sorted - ascending sorted latencies
 * @param {number} pct - 0-100
 * @returns {number}
 */
function percentile(sorted, pct) {
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── DB factory ───────────────────────────────────────────────────────────────

function openDb(name) {
  const Database = require('better-sqlite3');
  const db = Database(join(TMP, name));
  db.pragma('journal_mode = WAL');
  sqliteVec.load(db);
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  return db;
}

// ── Setup ────────────────────────────────────────────────────────────────────

if (existsSync(TMP)) rmSync(TMP, { recursive: true });
mkdirSync(TMP, { recursive: true });

// ── Build + populate fixture ──────────────────────────────────────────────────

console.log(`\nsetup: ${FIXTURE_SIZE} vectors`);

const fixture = [];
for (let i = 0; i < FIXTURE_SIZE; i++) {
  fixture.push({ name: `Entity:${i}`, vec: makeNormalizedVec(i) });
}

const db = openDb('latency-5k.db');
const sqliteBackend = new SqliteVecBackend({ db });
const bruteBackend = new BruteForceVectorBackend();

await test(`insert ${FIXTURE_SIZE} vectors into SqliteVecBackend`, async () => {
  await sqliteBackend.upsertBatch(fixture.map(({ name, vec }) => [name, vec]));
  const n = await sqliteBackend.count();
  assert(n === FIXTURE_SIZE, `Expected ${FIXTURE_SIZE}, got ${n}`);
});

await test(`load ${FIXTURE_SIZE} vectors into BruteForceVectorBackend`, async () => {
  await bruteBackend.addAll(fixture);
  const n = await bruteBackend.count();
  assert(n === FIXTURE_SIZE, `Expected ${FIXTURE_SIZE}, got ${n}`);
});

// ── Warm-up (avoid cold-start skew) ─────────────────────────────────────────

console.log('\nwarm-up (5 queries each backend, discarded)');
for (let i = 0; i < 5; i++) {
  const q = makeNormalizedVec(200000 + i);
  await sqliteBackend.search(q, TOP_K);
  await bruteBackend.search(q, TOP_K);
}

// ── SqliteVecBackend latency ─────────────────────────────────────────────────

console.log(`\nSqliteVecBackend: ${QUERY_COUNT} queries top-${TOP_K}`);

const sqliteLatencies = [];
await test(`SqliteVecBackend: ${QUERY_COUNT} searches complete without error`, async () => {
  for (let i = 0; i < QUERY_COUNT; i++) {
    const q = makeNormalizedVec(300000 + i);
    const t0 = performance.now();
    const results = await sqliteBackend.search(q, TOP_K);
    const elapsed = performance.now() - t0;
    sqliteLatencies.push(elapsed);
    assert(results.length > 0, `Query ${i} returned empty results`);
  }
});

sqliteLatencies.sort((a, b) => a - b);
const sqliteP50 = percentile(sqliteLatencies, 50);
const sqliteP95 = percentile(sqliteLatencies, 95);

console.log(`    p50: ${sqliteP50.toFixed(2)}ms  p95: ${sqliteP95.toFixed(2)}ms`);

await test(`SqliteVecBackend p95 <= ${SQLITE_P95_LIMIT_MS}ms`, async () => {
  assert(sqliteP95 <= SQLITE_P95_LIMIT_MS,
    `p95 = ${sqliteP95.toFixed(2)}ms exceeds ${SQLITE_P95_LIMIT_MS}ms limit`);
});

// ── BruteForceVectorBackend latency (informational) ──────────────────────────

console.log(`\nBruteForceVectorBackend: ${QUERY_COUNT} queries top-${TOP_K}`);

const bruteLatencies = [];
await test(`BruteForceVectorBackend: ${QUERY_COUNT} searches complete without error`, async () => {
  for (let i = 0; i < QUERY_COUNT; i++) {
    const q = makeNormalizedVec(400000 + i);
    const t0 = performance.now();
    const results = await bruteBackend.search(q, TOP_K);
    const elapsed = performance.now() - t0;
    bruteLatencies.push(elapsed);
    assert(results.length > 0, `Query ${i} returned empty results`);
  }
});

bruteLatencies.sort((a, b) => a - b);
const bruteP50 = percentile(bruteLatencies, 50);
const bruteP95 = percentile(bruteLatencies, 95);

console.log(`    p50: ${bruteP50.toFixed(2)}ms  p95: ${bruteP95.toFixed(2)}ms  (informational, no assertion)`);

// ── Cleanup ───────────────────────────────────────────────────────────────────

db.close();
try { if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); } catch { /* non-fatal */ }

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\nLatency summary:');
console.log(`  sqlite-vec   p50=${sqliteP50.toFixed(2)}ms  p95=${sqliteP95.toFixed(2)}ms`);
console.log(`  brute-force  p50=${bruteP50.toFixed(2)}ms  p95=${bruteP95.toFixed(2)}ms`);
console.log(`Results: ${passed} passed, ${failed} failed`);

// Export numbers for baseline update
process.env._LATENCY_SQLITE_P50 = String(sqliteP50.toFixed(2));
process.env._LATENCY_SQLITE_P95 = String(sqliteP95.toFixed(2));
process.env._LATENCY_BRUTE_P50 = String(bruteP50.toFixed(2));
process.env._LATENCY_BRUTE_P95 = String(bruteP95.toFixed(2));

process.exit(failed > 0 ? 1 : 0);
