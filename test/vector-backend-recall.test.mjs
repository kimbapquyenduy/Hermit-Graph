#!/usr/bin/env node
/**
 * vector-backend-recall.test.mjs — Recall@10 parity between SqliteVecBackend and BruteForceVectorBackend.
 *
 * Builds a 5k-vector fixture using deterministic PRNG (no real embeddings — fast).
 * Runs 100 query vectors through both backends, measures top-10 overlap.
 * Assert: average recall@10 >= 0.9 (i.e., 9/10 neighbours agree on average).
 *
 * Run: node test/vector-backend-recall.test.mjs
 */

import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import * as sqliteVec from 'sqlite-vec';
import { SqliteVecBackend } from '../scripts/lib/memory/sqlite-vec-adapter.mjs';
import { BruteForceVectorBackend } from '../scripts/lib/memory/brute-force-vector-fallback.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '..', 'tmp', 'vector-backend-recall-test');
const require = createRequire(import.meta.url);

const DIMS = 384;
const FIXTURE_SIZE = 5000;
const QUERY_COUNT = 100;
const TOP_K = 10;
const MIN_RECALL = 0.9;

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

/**
 * Generate a normalized random 384-dim vector (unit sphere).
 * Normalization ensures cosine distance == 1 - dot product (same as all-MiniLM output).
 * @param {number} seed
 * @returns {Float32Array}
 */
function makeNormalizedVec(seed) {
  const rng = mulberry32(seed);
  const v = Float32Array.from({ length: DIMS }, () => rng() * 2 - 1);
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
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

// ── Build fixture ─────────────────────────────────────────────────────────────

console.log(`\nbuild: ${FIXTURE_SIZE} entity vectors`);

/** @type {Array<{name: string, vec: Float32Array}>} */
const fixture = [];
for (let i = 0; i < FIXTURE_SIZE; i++) {
  fixture.push({ name: `Entity:${i}`, vec: makeNormalizedVec(i) });
}

// ── Populate both backends ────────────────────────────────────────────────────

const db = openDb('recall-5k.db');
const sqliteBackend = new SqliteVecBackend({ db });
const bruteBackend = new BruteForceVectorBackend();

await test(`populate SqliteVecBackend with ${FIXTURE_SIZE} vectors`, async () => {
  const pairs = fixture.map(({ name, vec }) => [name, vec]);
  await sqliteBackend.upsertBatch(pairs);
  const n = await sqliteBackend.count();
  assert(n === FIXTURE_SIZE, `Expected ${FIXTURE_SIZE} rows, got ${n}`);
});

await test(`populate BruteForceVectorBackend with ${FIXTURE_SIZE} vectors`, async () => {
  await bruteBackend.addAll(fixture);
  const n = await bruteBackend.count();
  assert(n === FIXTURE_SIZE, `Expected ${FIXTURE_SIZE}, got ${n}`);
});

// ── Recall@10 measurement ─────────────────────────────────────────────────────

console.log(`\nrecall@${TOP_K}: ${QUERY_COUNT} queries`);

let totalRecall = 0;

await test(`recall@${TOP_K} >= ${MIN_RECALL} over ${QUERY_COUNT} queries`, async () => {
  const QUERY_SEED_OFFSET = 100000; // offset from fixture seeds to get distinct query vectors

  for (let q = 0; q < QUERY_COUNT; q++) {
    const qvec = makeNormalizedVec(QUERY_SEED_OFFSET + q);

    const sqliteResults = await sqliteBackend.search(qvec, TOP_K);
    const bruteResults = await bruteBackend.search(qvec, TOP_K);

    const sqliteNames = new Set(sqliteResults.map(r => r.name));
    const bruteNames = new Set(bruteResults.map(r => r.name));

    // Recall = |intersection| / |brute-force top-K| (brute-force is ground truth)
    let intersection = 0;
    for (const name of bruteNames) {
      if (sqliteNames.has(name)) intersection++;
    }
    totalRecall += intersection / TOP_K;
  }

  const avgRecall = totalRecall / QUERY_COUNT;
  console.log(`    avg recall@${TOP_K}: ${(avgRecall * 100).toFixed(1)}% (min: ${(MIN_RECALL * 100).toFixed(0)}%)`);
  assert(avgRecall >= MIN_RECALL,
    `Recall@${TOP_K} = ${(avgRecall * 100).toFixed(1)}% is below the ${(MIN_RECALL * 100).toFixed(0)}% gate`);
});

const finalRecall = (totalRecall / QUERY_COUNT);

// ── Return shapes ─────────────────────────────────────────────────────────────

console.log('\nresult shape');

await test('SqliteVecBackend.search returns [{name, distance}]', async () => {
  const qvec = makeNormalizedVec(99999);
  const results = await sqliteBackend.search(qvec, 5);
  assert(Array.isArray(results), 'must return array');
  assert(results.length > 0, 'must return at least 1 result');
  for (const r of results) {
    assert(typeof r.name === 'string', 'name must be string');
    assert(typeof r.distance === 'number', 'distance must be number');
    assert(r.distance >= 0, `distance must be >= 0, got ${r.distance}`);
  }
});

await test('BruteForceVectorBackend.search returns [{name, distance}]', async () => {
  const qvec = makeNormalizedVec(99998);
  const results = await bruteBackend.search(qvec, 5);
  assert(Array.isArray(results), 'must return array');
  assert(results.length > 0, 'must return at least 1 result');
  for (const r of results) {
    assert(typeof r.name === 'string', 'name must be string');
    assert(typeof r.distance === 'number', 'distance must be number');
  }
});

await test('results sorted ascending by distance (lower = closer)', async () => {
  const qvec = makeNormalizedVec(77777);
  for (const backend of [sqliteBackend, bruteBackend]) {
    const results = await backend.search(qvec, 10);
    for (let i = 1; i < results.length; i++) {
      assert(results[i].distance >= results[i - 1].distance,
        `distances must be sorted ascending at index ${i}`);
    }
  }
});

await test('topK cap at 100 — request 200, get ≤ 100', async () => {
  const qvec = makeNormalizedVec(55555);
  const results = await sqliteBackend.search(qvec, 200);
  assert(results.length <= 100, `Should cap at 100, got ${results.length}`);
});

await test('invalid queryVec throws', async () => {
  let threw = false;
  try { await sqliteBackend.search(new Float32Array(10), 5); } catch { threw = true; }
  assert(threw, 'must throw on wrong dim');
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

db.close();
try { if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); } catch { /* non-fatal */ }

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nRecall@${TOP_K}: ${(finalRecall * 100).toFixed(1)}%`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
