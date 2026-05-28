#!/usr/bin/env node
/**
 * migration-roundtrip.test.mjs — End-to-end tests for JSONL→SQLite migration,
 * parity verification, and SQLite→JSONL export.
 *
 * Scenarios:
 *   1. Migrate 500-entity fixture → parity passes
 *   2. Export back → semantic equivalence
 *   3. Migrate TWICE on same DB → still parity (idempotency)
 *   4. Inject drift (delete entity from DB) → parity reports drift, exit 1
 *
 * Run: node test/migration-roundtrip.test.mjs
 */

import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

import { generateSampleVault } from '../scripts/lib/memory/test-fixtures.mjs';
import { SqliteProvider } from '../scripts/lib/memory/sqlite-backend.mjs';
import { JsonlProvider } from '../scripts/lib/memory/jsonl-provider.mjs';
import { checkParity } from '../scripts/lib/memory/parity-checker.mjs';
import {
  prepareStatements,
  writeEntityInTx,
} from '../scripts/lib/memory/sqlite-write-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TMP = join(ROOT, 'tmp', 'migration-roundtrip-test');
const require = createRequire(import.meta.url);

let passed = 0, failed = 0;

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

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

// ── Setup ──────────────────────────────────────────────────────────────────────

if (existsSync(TMP)) rmSync(TMP, { recursive: true });
mkdirSync(TMP, { recursive: true });

const JSONL_PATH    = join(TMP, 'brain.jsonl');
const DB_PATH       = join(TMP, 'brain.db');
const EXPORTED_PATH = join(TMP, 'brain.jsonl.exported');

// ── Write fixture to JSONL ────────────────────────────────────────────────────

console.log('\nfixture');

const vault = generateSampleVault({ size: 500, seed: 42 });

await test('generate 500-entity vault + write to JSONL', async () => {
  const lines = [];
  for (const [, e] of vault.entities) lines.push(JSON.stringify(e));
  for (const r of vault.relations) lines.push(JSON.stringify(r));
  writeFileSync(JSONL_PATH, lines.join('\n') + '\n', 'utf-8');
  assert(existsSync(JSONL_PATH), 'JSONL file must exist');
  const content = readFileSync(JSONL_PATH, 'utf-8').split('\n').filter(Boolean);
  assert(content.length === vault.entities.size + vault.relations.length, 'line count must match');
});

// ── Scenario 1: Migrate → parity ─────────────────────────────────────────────

console.log('\nscenario 1: migrate JSONL → SQLite');

/**
 * Run migration programmatically (reuses same logic as CLI script).
 * @param {string} jsonlPath
 * @param {string} dbPath
 * @returns {{ entityCount: number, relationCount: number, elapsedMs: number }}
 */
async function runMigration(jsonlPath, dbPath) {
  const { createInterface } = await import('readline');
  const { createReadStream } = await import('fs');
  const provider = new SqliteProvider({ dbPath });
  const db = provider._db;
  const stmts = prepareStatements(db);

  let entityCount = 0, relationCount = 0;
  let entityBatch = [], relationBatch = [];

  const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });

  const t0 = Date.now();
  for await (const line of rl) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (obj.type === 'entity') {
      entityBatch.push(obj);
      entityCount++;
    } else if (obj.type === 'relation') {
      relationBatch.push(obj);
      relationCount++;
    }
    if (entityBatch.length + relationBatch.length >= 200) {
      db.transaction(() => {
        for (const e of entityBatch) writeEntityInTx(stmts, e);
        for (const r of relationBatch) stmts.upsertRelation.run({ fromName: r.from, toName: r.to, relationType: r.relationType });
      })();
      entityBatch = [];
      relationBatch = [];
    }
  }
  if (entityBatch.length > 0 || relationBatch.length > 0) {
    db.transaction(() => {
      for (const e of entityBatch) writeEntityInTx(stmts, e);
      for (const r of relationBatch) stmts.upsertRelation.run({ fromName: r.from, toName: r.to, relationType: r.relationType });
    })();
  }
  db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`);
  provider.close();
  return { entityCount, relationCount, elapsedMs: Date.now() - t0 };
}

let migrationMs = 0;

await test('migration completes without errors', async () => {
  const result = await runMigration(JSONL_PATH, DB_PATH);
  migrationMs = result.elapsedMs;
  assert(existsSync(DB_PATH), 'brain.db must be created');
  assert(result.entityCount === vault.entities.size,
    `entity count mismatch: expected ${vault.entities.size}, got ${result.entityCount}`);
  console.log(`    migrated ${result.entityCount} entities + ${result.relationCount} relations in ${result.elapsedMs}ms`);
});

await test('migration completes in < 10 seconds', async () => {
  assert(migrationMs < 10000, `migration took ${migrationMs}ms, expected < 10000ms`);
});

await test('parity check passes after migration', async () => {
  const jsonlProvider = new JsonlProvider({ brainPath: JSONL_PATH });
  const sqliteProvider = new SqliteProvider({ dbPath: DB_PATH });
  const [jData, sData] = await Promise.all([jsonlProvider.readAll(), sqliteProvider.readAll()]);
  const { parity, report } = checkParity(jData, sData);
  sqliteProvider.close();
  assert(parity,
    `parity failed: missingInDb=${report.missingInDb.length}, drifted=${report.driftedObservations.length}`);
});

// ── Scenario 2: Export → semantic equivalence ─────────────────────────────────

console.log('\nscenario 2: export SQLite → JSONL');

await test('export produces JSONL file', async () => {
  const sqliteProvider = new SqliteProvider({ dbPath: DB_PATH });
  const { entities, relations } = await sqliteProvider.readAll();
  const lines = [];
  for (const [, e] of entities) lines.push(JSON.stringify({ type: 'entity', name: e.name, entityType: e.entityType, observations: e.observations || [] }));
  for (const r of relations) lines.push(JSON.stringify({ type: 'relation', from: r.from, to: r.to, relationType: r.relationType }));
  writeFileSync(EXPORTED_PATH, lines.join('\n') + '\n', 'utf-8');
  sqliteProvider.close();
  assert(existsSync(EXPORTED_PATH), 'exported JSONL must exist');
});

await test('exported JSONL is semantically equivalent to original', async () => {
  const origProvider = new JsonlProvider({ brainPath: JSONL_PATH });
  const expProvider  = new JsonlProvider({ brainPath: EXPORTED_PATH });
  const [origData, expData] = await Promise.all([origProvider.readAll(), expProvider.readAll()]);
  const { parity, report } = checkParity(origData, expData);
  assert(parity,
    `exported JSONL parity failed: missingInDb=${report.missingInDb.length}, drifted=${report.driftedObservations.length}`);
  assert(origData.entities.size === expData.entities.size, 'entity count must match after round-trip');
});

// ── Scenario 3: Idempotency (migrate twice) ───────────────────────────────────

console.log('\nscenario 3: idempotency — migrate twice on same DB');

await test('second migration run is idempotent (no duplicates)', async () => {
  await runMigration(JSONL_PATH, DB_PATH);

  const sqliteProvider = new SqliteProvider({ dbPath: DB_PATH });
  const DB = require('better-sqlite3');
  const db = DB(DB_PATH);
  const entityCount = db.prepare('SELECT COUNT(*) AS n FROM entities').get().n;
  const obsCount    = db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
  db.close();
  sqliteProvider.close();

  assert(entityCount === vault.entities.size,
    `entity count after 2nd run: expected ${vault.entities.size}, got ${entityCount}`);
  console.log(`    entities=${entityCount}, observations=${obsCount}`);
});

await test('parity still holds after second migration', async () => {
  const jsonlProvider  = new JsonlProvider({ brainPath: JSONL_PATH });
  const sqliteProvider = new SqliteProvider({ dbPath: DB_PATH });
  const [jData, sData] = await Promise.all([jsonlProvider.readAll(), sqliteProvider.readAll()]);
  const { parity } = checkParity(jData, sData);
  sqliteProvider.close();
  assert(parity, 'parity must hold after idempotent re-migration');
});

// ── Scenario 4: Drift injection ────────────────────────────────────────────────

console.log('\nscenario 4: drift injection — delete entity from DB, expect parity=false');

await test('parity reports drift after manual entity deletion', async () => {
  const DB = require('better-sqlite3');
  const db = DB(DB_PATH);
  const firstEntity = db.prepare('SELECT name FROM entities LIMIT 1').get();
  db.prepare('DELETE FROM observations WHERE entity_name = ?').run(firstEntity.name);
  db.prepare('DELETE FROM entities WHERE name = ?').run(firstEntity.name);
  db.close();

  const jsonlProvider  = new JsonlProvider({ brainPath: JSONL_PATH });
  const sqliteProvider = new SqliteProvider({ dbPath: DB_PATH });
  const [jData, sData] = await Promise.all([jsonlProvider.readAll(), sqliteProvider.readAll()]);
  const { parity, report } = checkParity(jData, sData);
  sqliteProvider.close();

  assert(!parity, 'parity must be false after drift injection');
  assert(report.missingInDb.includes(firstEntity.name),
    `deleted entity "${firstEntity.name}" must appear in missingInDb`);
  console.log(`    drift correctly detected: missingInDb=${report.missingInDb.length}`);
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

rmSync(TMP, { recursive: true });

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
