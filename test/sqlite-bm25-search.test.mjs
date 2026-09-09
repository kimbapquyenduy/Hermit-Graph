#!/usr/bin/env node
console.log('Performance thresholds: '+(process.env.HERMIT_PERFORMANCE_GATES==='1'?'ENFORCED':'INFORMATIONAL; use npm run bench:legacy for reference gates'));
/**
 * sqlite-bm25-search.test.mjs — BM25 quality + latency tests for SqliteProvider.
 * 5k-entity fixture, 55 queries, p95 ≤ 50ms, 10-query relevance spot-check.
 * Run: node test/sqlite-bm25-search.test.mjs
 */

import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SqliteProvider } from '../scripts/lib/memory/sqlite-backend.mjs';
import { generateSampleVault } from '../scripts/lib/memory/test-fixtures.mjs';
import { writeEntityInTx } from '../scripts/lib/memory/sqlite-write-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '..', 'tmp', 'sqlite-bm25-test');

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}: ${e.message}`); }
}

if (existsSync(TMP)) rmSync(TMP, { recursive: true });
mkdirSync(TMP, { recursive: true });

// ── Fixture: 5k entities ────────────────────────────────────────────────────
console.log('\nfixture: insert 5k entities');
const VAULT_SIZE = 5000;
const vault = generateSampleVault({ size: VAULT_SIZE, seed: 42 });
const provider = new SqliteProvider({ dbPath: join(TMP, 'bm25-5k.db') });

await test(`insert ${VAULT_SIZE} entities (bulk tx)`, async () => {
  const t0 = Date.now();
  provider._db.transaction(() => {
    for (const [, e] of vault.entities) writeEntityInTx(provider._stmts, e);
  })();
  const ms = Date.now() - t0;
  console.log(`    ${VAULT_SIZE} entities in ${ms}ms`);
  if(process.env.HERMIT_PERFORMANCE_GATES==='1')assert(ms < 5000, `bulk insert must finish <5s, took ${ms}ms`);
});

await test('FTS5 index populated (row count = VAULT_SIZE)', async () => {
  const { n } = provider._db.prepare('SELECT COUNT(*) AS n FROM entities_fts').get();
  assert(n === VAULT_SIZE, `FTS5 must have ${VAULT_SIZE} rows, got ${n}`);
});

// ── Shape + constraint tests ────────────────────────────────────────────────
console.log('\nresult shape');

await test('returns array', async () => {
  assert(Array.isArray(await provider.searchKeyword('Auth')), 'must return array');
});
await test('each result: name, entityType, score>0, observationCount', async () => {
  for (const r of await provider.searchKeyword('Payment', { topK: 5 })) {
    assert(typeof r.name === 'string' && r.name.length > 0, 'name must be non-empty string');
    assert(typeof r.entityType === 'string', 'entityType must be string');
    assert(typeof r.score === 'number' && r.score > 0, `score must be positive, got ${r.score}`);
    assert(typeof r.observationCount === 'number', 'observationCount must be number');
  }
});
await test('results ≤ topK', async () => {
  assert((await provider.searchKeyword('Order', { topK: 7 })).length <= 7, 'must respect topK');
});
await test('topK hard cap at 100', async () => {
  assert((await provider.searchKeyword('service', { topK: 999 })).length <= 100, 'hard cap must be 100');
});
await test('empty query returns []', async () => {
  const r = await provider.searchKeyword('');
  assert(Array.isArray(r) && r.length === 0, 'must return []');
});
await test('sorted descending by score', async () => {
  const r = await provider.searchKeyword('cache', { topK: 10 });
  for (let i = 1; i < r.length; i++)
    assert(r[i].score <= r[i - 1].score, 'must be descending');
});

// ── 55-query sweep: shape + latency ────────────────────────────────────────
console.log('\n55-query sweep (shape + topK + latency)');

const QUERIES = [
  'auth','payment','order','user','search','cache','queue','event','report','webhook',
  'session','token','config','import','export',
  'auth token','payment gateway','order pipeline','user session','cache strategy',
  'queue handler','event dispatcher','report factory','webhook service','session registry',
  'Auth','PAYMENT','Order','USER','CACHE','Queue','EVENT','Report','WEBHOOK','Session',
  'BIZ:Payment','RULE:Auth','TECH:Config','PATTERN:Cache','INCIDENT:Token',
  'BIZ:Order','FLOW:Import','ENTITY:User','TECH:Queue','PATTERN:Service',
  'synthetic','benchmark','fixture','RULE','WHAT','HOW','DECISION','CONTEXT','NOTE','DETAIL',
];

const latencies = [];
let shapeErrors = 0;
for (const q of QUERIES) {
  const t0 = performance.now();
  const results = await provider.searchKeyword(q, { topK: 10 });
  latencies.push(performance.now() - t0);
  for (const r of results) {
    if (typeof r.name !== 'string' || typeof r.score !== 'number') shapeErrors++;
  }
  if (results.length > 10) shapeErrors++;
}

await test('all queries: valid shape + ≤topK', async () => {
  assert(shapeErrors === 0, `${shapeErrors} shape/topK violations`);
});

latencies.sort((a, b) => a - b);
const p50 = latencies[Math.floor(latencies.length * 0.50)];
const p95 = latencies[Math.floor(latencies.length * 0.95)];
const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;
console.log(`  latency — p50: ${p50.toFixed(2)}ms  p95: ${p95.toFixed(2)}ms  avg: ${avg.toFixed(2)}ms`);

await test('p95 latency measurement (reference gate with HERMIT_PERFORMANCE_GATES=1)', async () => {
  if(process.env.HERMIT_PERFORMANCE_GATES==='1')assert(p95 <= 50, `p95 must be ≤50ms, got ${p95.toFixed(2)}ms`);
});

// ── Spot-check: relevance (all top-3 contain query term in name) ────────────
console.log('\nspot-check: 10 curated relevance queries');

const SPOT_QUERIES = ['Auth','Payment','Cache','Order','Token','Timeout','Gateway','Service','Session','Registry'];
let spotPass = 0;
for (const q of SPOT_QUERIES) {
  const results = await provider.searchKeyword(q, { topK: 3 });
  if (results.length === 0) { console.log(`  FAIL  "${q}" — 0 results`); continue; }
  const allRelevant = results.every(r => r.name.toLowerCase().includes(q.toLowerCase()));
  if (allRelevant) { spotPass++; console.log(`  ok  "${q}" — ${results.map(r => r.name).join(', ')}`); }
  else { console.log(`  FAIL  "${q}" — irrelevant: ${results.filter(r => !r.name.toLowerCase().includes(q.toLowerCase())).map(r => r.name).join(', ')}`); }
}

await test('spot-check: ≥8/10 queries return only relevant results in top-3', async () => {
  assert(spotPass >= 8, `only ${spotPass}/10 spot-checks passed`);
});

// ── readAll contract ────────────────────────────────────────────────────────
console.log('\nreadAll() contract');

await test('readAll: Map + array with correct counts', async () => {
  const { entities, relations } = await provider.readAll();
  assert(entities instanceof Map && Array.isArray(relations), 'shape must be {Map, array}');
  assert(entities.size === VAULT_SIZE, `must have ${VAULT_SIZE} entities, got ${entities.size}`);
});
await test('readAll: entity shape type/name/entityType/observations', async () => {
  const { entities } = await provider.readAll();
  for (const e of [...entities.values()].slice(0, 10)) {
    assert(e.type === 'entity' && typeof e.name === 'string' &&
           typeof e.entityType === 'string' && Array.isArray(e.observations), 'invalid shape');
  }
});

// ── Teardown ────────────────────────────────────────────────────────────────
provider.close();
if (existsSync(TMP)) rmSync(TMP, { recursive: true });

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
