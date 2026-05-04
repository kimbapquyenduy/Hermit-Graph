#!/usr/bin/env node
/**
 * sqlite-write.test.mjs — Write-path contract tests for SqliteProvider.
 * Covers: boot idempotency, writeEntity/getEntity round-trip, UPSERT,
 * observation prefix parsing, writeRelation dedup, deleteEntity, throughput.
 *
 * Run: node test/sqlite-write.test.mjs
 */

import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SqliteProvider } from '../scripts/lib/memory/sqlite-backend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '..', 'tmp', 'sqlite-write-test');

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

function makeProvider(filename = 'brain.db') {
  return new SqliteProvider({ dbPath: join(TMP, filename) });
}

// ── Setup ──────────────────────────────────────────────────────────────────
if (existsSync(TMP)) rmSync(TMP, { recursive: true });
mkdirSync(TMP, { recursive: true });

// ── Boot ────────────────────────────────────────────────────────────────────
console.log('\nboot');

await test('creates fresh brain.db in tmp dir', async () => {
  const p = makeProvider('boot-fresh.db');
  assert(existsSync(join(TMP, 'boot-fresh.db')), 'db file must exist after construction');
  p.close();
});

await test('re-boot is idempotent (no schema errors, no dupe meta rows)', async () => {
  const dbPath = join(TMP, 'boot-idempotent.db');
  const p1 = new SqliteProvider({ dbPath });
  p1.close();
  // Second open on same file — must not throw
  const p2 = new SqliteProvider({ dbPath });
  const createRequire = (await import('module')).createRequire;
  const require = createRequire(import.meta.url);
  const DB = require('better-sqlite3');
  const db = DB(dbPath);
  const count = db.prepare(`SELECT COUNT(*) as n FROM meta WHERE key='schema_version'`).get();
  assert(count.n === 1, `schema_version must appear exactly once, got ${count.n}`);
  db.close();
  p2.close();
});

// ── writeEntity + getEntity ─────────────────────────────────────────────────
console.log('\nwriteEntity() + getEntity()');

await test('round-trip: write then read back same entity', async () => {
  const p = makeProvider('rw-basic.db');
  const entity = {
    type: 'entity', name: 'TECH:Test:Alpha',
    entityType: 'tech-stack',
    observations: ['[0.9|2026-01-01] NOTE: round-trip test'],
  };
  await p.withLock(() => p.writeEntity(entity));
  const back = await p.getEntity('TECH:Test:Alpha');
  assert(back !== null, 'entity must be readable after write');
  assert(back.name === 'TECH:Test:Alpha', 'name must match');
  assert(back.entityType === 'tech-stack', 'entityType must match');
  assert(back.observations.length === 1, 'observations count must match');
  p.close();
});

await test('getEntity is case-insensitive', async () => {
  const p = makeProvider('rw-case.db');
  const entity = { type: 'entity', name: 'BIZ:Foo:Bar', entityType: 'biz-domain', observations: [] };
  await p.withLock(() => p.writeEntity(entity));
  const back = await p.getEntity('biz:foo:bar');
  assert(back !== null, 'case-insensitive lookup must succeed');
  p.close();
});

await test('upsert: writing same entity twice replaces observations cleanly', async () => {
  const p = makeProvider('rw-upsert.db');
  const base = { type: 'entity', name: 'TECH:Test:Upsert', entityType: 'tech-stack', observations: ['[0.7] original'] };
  await p.withLock(() => p.writeEntity(base));
  const updated = { ...base, observations: ['[0.9|2026-03-01] updated obs'] };
  await p.withLock(() => p.writeEntity(updated));
  const back = await p.getEntity('TECH:Test:Upsert');
  assert(back.observations.length === 1, `upsert must leave exactly 1 obs, got ${back.observations.length}`);
  assert(back.observations[0].includes('updated'), 'observation must reflect latest write');
  p.close();
});

// ── Observation prefix parsing ───────────────────────────────────────────────
console.log('\nobservation prefix parsing');

await test('parses confidence + date into columns', async () => {
  const dbPath = join(TMP, 'obs-parsed.db');
  const p = new SqliteProvider({ dbPath });
  const entity = {
    type: 'entity', name: 'PATTERN:Test:Parsed',
    entityType: 'pattern-code',
    observations: ['[0.85|2026-04-15] RULE: some rule here'],
  };
  await p.withLock(() => p.writeEntity(entity));
  p.close();

  // Inspect raw columns
  const createRequire = (await import('module')).createRequire;
  const require = createRequire(import.meta.url);
  const DB = require('better-sqlite3');
  const db = DB(dbPath);
  const row = db.prepare(`SELECT confidence, obs_date, category FROM observations WHERE entity_name = ?`).get('PATTERN:Test:Parsed');
  db.close();

  assert(Math.abs(row.confidence - 0.85) < 0.001, `confidence must be 0.85, got ${row.confidence}`);
  assert(row.obs_date === '2026-04-15', `obs_date must be 2026-04-15, got ${row.obs_date}`);
  assert(row.category === 'RULE', `category must be RULE, got ${row.category}`);
});

await test('legacy obs (no prefix) defaults confidence=0.8, date=null', async () => {
  const dbPath = join(TMP, 'obs-legacy.db');
  const p = new SqliteProvider({ dbPath });
  await p.withLock(() => p.writeEntity({
    type: 'entity', name: 'TECH:Legacy:Node',
    entityType: 'tech-stack',
    observations: ['NOTE: no prefix here'],
  }));
  p.close();

  const createRequire = (await import('module')).createRequire;
  const require = createRequire(import.meta.url);
  const DB = require('better-sqlite3');
  const db = DB(dbPath);
  const row = db.prepare(`SELECT confidence, obs_date FROM observations WHERE entity_name = ?`).get('TECH:Legacy:Node');
  db.close();

  assert(Math.abs(row.confidence - 0.8) < 0.001, `legacy default confidence must be 0.8, got ${row.confidence}`);
  assert(row.obs_date === null, `legacy obs_date must be null, got ${row.obs_date}`);
});

// ── writeRelation ────────────────────────────────────────────────────────────
console.log('\nwriteRelation()');

await test('persists a relation', async () => {
  const dbPath = join(TMP, 'rel-basic.db');
  const p = new SqliteProvider({ dbPath });
  await p.withLock(() => p.writeRelation({ from: 'A', to: 'B', relationType: 'uses' }));
  p.close();

  const createRequire = (await import('module')).createRequire;
  const require = createRequire(import.meta.url);
  const DB = require('better-sqlite3');
  const db = DB(dbPath);
  const row = db.prepare(`SELECT * FROM relations WHERE from_name='A' AND to_name='B'`).get();
  db.close();
  assert(row !== undefined, 'relation must exist in db');
  assert(row.relation_type === 'uses', 'relationType must match');
});

await test('writeRelation deduplicates via UNIQUE', async () => {
  const dbPath = join(TMP, 'rel-dedup.db');
  const p = new SqliteProvider({ dbPath });
  const rel = { from: 'X', to: 'Y', relationType: 'depends_on' };
  await p.withLock(() => p.writeRelation(rel));
  await p.withLock(() => p.writeRelation(rel));
  p.close();

  const createRequire = (await import('module')).createRequire;
  const require = createRequire(import.meta.url);
  const DB = require('better-sqlite3');
  const db = DB(dbPath);
  const count = db.prepare(`SELECT COUNT(*) as n FROM relations`).get();
  db.close();
  assert(count.n === 1, `duplicate relation must not be inserted twice, got ${count.n}`);
});

// ── deleteEntity ─────────────────────────────────────────────────────────────
console.log('\ndeleteEntity()');

await test('removes entity + observations, returns true', async () => {
  const p = makeProvider('del-entity.db');
  const entity = { type: 'entity', name: 'TECH:Del:Target', entityType: 'tech-stack', observations: ['[0.8] obs1'] };
  await p.withLock(() => p.writeEntity(entity));
  const deleted = await p.withLock(() => p.deleteEntity('TECH:Del:Target'));
  assert(deleted === true, 'deleteEntity must return true for existing entity');
  const back = await p.getEntity('TECH:Del:Target');
  assert(back === null, 'deleted entity must not be readable');
  p.close();
});

await test('returns false for non-existent entity', async () => {
  const p = makeProvider('del-missing.db');
  const result = await p.withLock(() => p.deleteEntity('TECH:Ghost:None'));
  assert(result === false, 'deleteEntity must return false when entity not found');
  p.close();
});

await test('deleteEntity also removes its relations', async () => {
  const dbPath = join(TMP, 'del-relations.db');
  const p = new SqliteProvider({ dbPath });
  await p.withLock(() => p.writeEntity({ type: 'entity', name: 'A', entityType: 'tech-stack', observations: [] }));
  await p.withLock(() => p.writeRelation({ from: 'A', to: 'B', relationType: 'uses' }));
  await p.withLock(() => p.writeRelation({ from: 'C', to: 'A', relationType: 'depends_on' }));
  await p.withLock(() => p.deleteEntity('A'));
  p.close();

  const createRequire = (await import('module')).createRequire;
  const require = createRequire(import.meta.url);
  const DB = require('better-sqlite3');
  const db = DB(dbPath);
  const count = db.prepare(`SELECT COUNT(*) as n FROM relations`).get();
  db.close();
  assert(count.n === 0, `all relations for deleted entity must be removed, got ${count.n}`);
});

// ── Throughput smoke ─────────────────────────────────────────────────────────
console.log('\nthroughput');

await test('1000 entities write in <1s', async () => {
  const { writeEntityInTx } = await import('../scripts/lib/memory/sqlite-write-helpers.mjs');
  const p = makeProvider('throughput.db');
  const N = 1000;
  const entities = Array.from({ length: N }, (_, i) => ({
    type: 'entity', name: `TECH:Bench:Entity${i}`,
    entityType: 'tech-stack',
    observations: [`[0.8|2026-01-01] NOTE: bench entity ${i}`],
  }));
  const t0 = Date.now();
  const bulk = p._db.transaction(() => {
    for (const e of entities) writeEntityInTx(p._stmts, e);
  });
  bulk();
  const elapsed = Date.now() - t0;
  const throughput = Math.round(N / (elapsed / 1000));
  console.log(`    1000 entities in ${elapsed}ms = ${throughput}/sec`);
  assert(elapsed < 1000, `throughput too slow: ${elapsed}ms (must be <1000ms)`);
  p.close();
});

// ── Teardown ─────────────────────────────────────────────────────────────────
if (existsSync(TMP)) rmSync(TMP, { recursive: true });

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
