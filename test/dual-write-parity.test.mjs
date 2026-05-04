#!/usr/bin/env node
/**
 * dual-write-parity.test.mjs — Soak, failure-injection, flag-off, and latency tests
 * for DualWriter (Phase 01b).
 *
 * Run: node test/dual-write-parity.test.mjs
 */

import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { createRequire } from 'module';

import { DualWriter } from '../scripts/lib/memory/dual-writer.mjs';
import { JsonlProvider } from '../scripts/lib/memory/jsonl-provider.mjs';
import { SqliteProvider } from '../scripts/lib/memory/sqlite-backend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '..', 'tmp', 'dual-write-parity-test');
const require = createRequire(import.meta.url);

let passed = 0, failed = 0;

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

/** Content hash for an entity: sort observations, join, SHA1 prefix. */
function entityHash(entity) {
  const obs = [...(entity.observations || [])].sort().join('|');
  return createHash('sha1').update(`${entity.name}::${entity.entityType}::${obs}`).digest('hex').slice(0, 16);
}

/** Read all entities from SQLite db file directly. */
function readSqliteEntities(dbPath) {
  const DB = require('better-sqlite3');
  const db = DB(dbPath);
  const rows = db.prepare(`
    SELECT e.name, e.entity_type,
           GROUP_CONCAT(o.raw_text, '|||') AS obs_raw
    FROM entities e
    LEFT JOIN observations o ON o.entity_name = e.name
    GROUP BY e.name, e.entity_type
  `).all();
  db.close();
  return rows.map(r => ({
    name: r.name,
    entityType: r.entity_type,
    observations: r.obs_raw ? r.obs_raw.split('|||') : [],
  }));
}

/** Read all relations from SQLite db file directly. */
function readSqliteRelations(dbPath) {
  const DB = require('better-sqlite3');
  const db = DB(dbPath);
  const rows = db.prepare(`SELECT from_name, to_name, relation_type FROM relations`).all();
  db.close();
  return rows.map(r => ({ from: r.from_name, to: r.to_name, relationType: r.relation_type }));
}

/** Track all open SQLite providers for teardown. */
const _openSqlite = [];

/** Make a fresh DualWriter in a temp subdir. Returns { writer, jsonlPath, dbPath, jsonl, sqlite }. */
function makeSetup(subdir, enabled = true) {
  const dir = join(TMP, subdir);
  mkdirSync(dir, { recursive: true });
  const jsonlPath = join(dir, 'brain.jsonl');
  const dbPath = join(dir, 'brain.db');
  const jsonl = new JsonlProvider({ brainPath: jsonlPath });
  const sqlite = new SqliteProvider({ dbPath });
  _openSqlite.push(sqlite);
  const writer = new DualWriter({ jsonlProvider: jsonl, sqliteProvider: sqlite, enabled });
  return { writer, jsonlPath, dbPath, jsonl, sqlite };
}

// ── Setup ────────────────────────────────────────────────────────────────────
if (existsSync(TMP)) rmSync(TMP, { recursive: true });
mkdirSync(TMP, { recursive: true });

// ── Soak: 1000 entities ───────────────────────────────────────────────────────
console.log('\nsoak: 1000 entities');

await test('1000 entities — JSONL count == SQLite count, zero hash drift', async () => {
  const { writer, jsonlPath, dbPath, jsonl, sqlite } = makeSetup('soak-entities');
  const N = 1000;

  for (let i = 0; i < N; i++) {
    await writer.writeBoth({
      entities: [{
        type: 'entity',
        name: `TECH:Soak:Entity${i}`,
        entityType: 'tech-stack',
        observations: [`[0.8|2026-01-01] NOTE: soak entity ${i}`, `[0.9|2026-01-02] DETAIL: index ${i}`],
      }],
    });
  }

  // JSONL count
  const { entities: jsonlEntities } = await jsonl.readAll();
  assert(jsonlEntities.size === N, `JSONL must have ${N} entities, got ${jsonlEntities.size}`);

  // SQLite count
  const sqliteEntities = readSqliteEntities(dbPath);
  assert(sqliteEntities.length === N, `SQLite must have ${N} entities, got ${sqliteEntities.length}`);

  // Content hash parity
  let drift = 0;
  const sqliteByName = new Map(sqliteEntities.map(e => [e.name, e]));
  for (const [name, jsonlEntity] of jsonlEntities) {
    const sq = sqliteByName.get(name);
    if (!sq) { drift++; continue; }
    const jHash = entityHash(jsonlEntity);
    const sHash = entityHash(sq);
    if (jHash !== sHash) drift++;
  }
  assert(drift === 0, `Content hash drift: ${drift} entities mismatched between JSONL and SQLite`);
  console.log(`    1000 entities: ${drift} drift`);
});

// ── Soak: 500 relations ───────────────────────────────────────────────────────
console.log('\nsoak: 500 relations');

await test('500 relations — count parity + tuple parity', async () => {
  const { writer, jsonlPath, dbPath, jsonl, sqlite } = makeSetup('soak-relations');
  const N = 500;

  // Pre-seed entities (relations need entities for JSONL dedup check)
  // SQLite doesn't enforce FK here so we can write relations directly
  for (let i = 0; i < N; i++) {
    await writer.writeBoth({
      relations: [{ from: `EntityA${i}`, to: `EntityB${i}`, relationType: 'depends_on' }],
    });
  }

  // JSONL relation count
  const { relations: jsonlRels } = await jsonl.readAll();
  assert(jsonlRels.length === N, `JSONL must have ${N} relations, got ${jsonlRels.length}`);

  // SQLite relation count
  const sqliteRels = readSqliteRelations(dbPath);
  assert(sqliteRels.length === N, `SQLite must have ${N} relations, got ${sqliteRels.length}`);

  // Tuple parity
  const sqliteSet = new Set(sqliteRels.map(r => `${r.from}→${r.to}::${r.relationType}`));
  let mismatch = 0;
  for (const r of jsonlRels) {
    const key = `${r.from}→${r.to}::${r.relationType}`;
    if (!sqliteSet.has(key)) mismatch++;
  }
  assert(mismatch === 0, `Relation tuple mismatch: ${mismatch} relations in JSONL not found in SQLite`);
  console.log(`    500 relations: ${mismatch} mismatch`);
});

// ── Failure injection ─────────────────────────────────────────────────────────
console.log('\nfailure injection');

await test('SQLite throws on every 5th call — JSONL has all 50, failureCount===10, no exception', async () => {
  const { writer, jsonlPath, dbPath, jsonl, sqlite } = makeSetup('failure-inject');
  let callCount = 0;
  const origWriteEntity = sqlite.writeEntity.bind(sqlite);
  sqlite.writeEntity = async (entity) => {
    callCount++;
    if (callCount % 5 === 0) throw new Error('injected SQLite failure');
    return origWriteEntity(entity);
  };

  const N = 50;
  for (let i = 0; i < N; i++) {
    // Must not throw
    await writer.writeBoth({
      entities: [{
        type: 'entity', name: `TECH:Inject:E${i}`,
        entityType: 'tech-stack',
        observations: [`[0.8|2026-01-01] NOTE: inject ${i}`],
      }],
    });
  }

  // JSONL must have all 50
  const { entities: jsonlEntities } = await jsonl.readAll();
  assert(jsonlEntities.size === N, `JSONL must have ${N} entities, got ${jsonlEntities.size}`);

  // Failure count must be 10 (every 5th of 50 = calls 5,10,15,...50 = 10 failures)
  const stats = writer.getStats();
  assert(stats.sqliteFailureCount === 10, `sqliteFailureCount must be 10, got ${stats.sqliteFailureCount}`);
  console.log(`    failureCount=${stats.sqliteFailureCount} (expected 10)`);
});

// ── Flag off ──────────────────────────────────────────────────────────────────
console.log('\nflag off (HERMIT_DUAL_WRITE=0)');

await test('enabled:false — SQLite never written, getStats().enabled===false', async () => {
  const { writer, jsonlPath, dbPath, jsonl, sqlite } = makeSetup('flag-off', false);

  await writer.writeBoth({
    entities: [{ type: 'entity', name: 'TECH:FlagOff:Test', entityType: 'tech-stack', observations: ['[0.8|2026-01-01] NOTE: test'] }],
  });

  // JSONL must have the entity
  const { entities } = await jsonl.readAll();
  assert(entities.has('TECH:FlagOff:Test'), 'JSONL must have entity even when dual-write disabled');

  // SQLite must be empty
  const sqliteEntities = readSqliteEntities(dbPath);
  assert(sqliteEntities.length === 0, `SQLite must be empty when disabled, got ${sqliteEntities.length}`);

  // getStats().enabled must be false
  const stats = writer.getStats();
  assert(stats.enabled === false, `getStats().enabled must be false`);
});

// ── Latency bench ─────────────────────────────────────────────────────────────
console.log('\nlatency benchmark');

await test('1000-entity dual-write latency vs JSONL-only baseline', async () => {
  const N = 1000;

  // JSONL-only baseline
  const baseDir = join(TMP, 'latency-baseline');
  mkdirSync(baseDir, { recursive: true });
  const baseJsonl = new JsonlProvider({ brainPath: join(baseDir, 'brain.jsonl') });
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await baseJsonl.withLock(() => baseJsonl.writeEntity({
      type: 'entity', name: `TECH:Lat:Base${i}`, entityType: 'tech-stack',
      observations: [`[0.8|2026-01-01] NOTE: baseline ${i}`],
    }));
  }
  const baselineMs = Date.now() - t0;
  const baselineThroughput = Math.round(N / (baselineMs / 1000));

  // Dual-write
  const { writer, jsonlPath, dbPath, sqlite } = makeSetup('latency-dual');
  const t1 = Date.now();
  for (let i = 0; i < N; i++) {
    await writer.writeBoth({
      entities: [{
        type: 'entity', name: `TECH:Lat:Dual${i}`, entityType: 'tech-stack',
        observations: [`[0.8|2026-01-01] NOTE: dual ${i}`],
      }],
    });
  }
  const dualMs = Date.now() - t1;
  const dualThroughput = Math.round(N / (dualMs / 1000));

  const overheadPct = ((dualMs - baselineMs) / baselineMs * 100).toFixed(1);
  console.log(`    JSONL-only: ${baselineMs}ms (${baselineThroughput}/sec)`);
  console.log(`    Dual-write: ${dualMs}ms (${dualThroughput}/sec)`);
  console.log(`    Overhead: ${overheadPct}%`);

  if (parseFloat(overheadPct) > 30) {
    console.log(`    [CONCERN] Overhead ${overheadPct}% exceeds 30% threshold — log for review`);
    // Not a hard failure — log concern, do not throw
  }

  // Verify parity in the dual-write run
  const sqliteEntities = readSqliteEntities(dbPath);
  assert(sqliteEntities.length === N, `SQLite must have ${N} entities after latency bench, got ${sqliteEntities.length}`);

  // Append to baseline-v6.7.json (writeFileSync already imported at top)
  const baselineFile = join(__dirname, '..', 'test', 'baseline-v6.7.json');
  try {
    const { writeFileSync: wfs } = await import('fs');
    const data = JSON.parse(readFileSync(baselineFile, 'utf8'));
    data.phase01b = {
      date: new Date().toISOString().slice(0, 10),
      jsonlOnlyMs: baselineMs,
      dualWriteMs: dualMs,
      overheadPct: parseFloat(overheadPct),
      throughputJsonlPerSec: baselineThroughput,
      throughputDualPerSec: dualThroughput,
      entities: N,
      note: 'Phase 01b dual-write latency benchmark',
    };
    wfs(baselineFile, JSON.stringify(data, null, 2) + '\n');
    console.log(`    Baseline updated: ${baselineFile}`);
  } catch (e) {
    console.log(`    Warning: could not update baseline file: ${e.message}`);
  }
});

// ── Teardown ──────────────────────────────────────────────────────────────────
// Close all open SQLite handles before removing temp dir (Windows: files locked while open)
for (const sq of _openSqlite) { try { sq.close(); } catch { /* already closed */ } }
if (existsSync(TMP)) rmSync(TMP, { recursive: true });

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
