#!/usr/bin/env node
/**
 * verify-parity.mjs — Semantic diff between brain.jsonl and brain.db.
 * Loads both stores, runs parity check, reports drift.
 *
 * Usage:
 *   node scripts/verify-parity.mjs [options]
 *
 * Options:
 *   --jsonl <path>   Source JSONL (default: data/brain.jsonl)
 *   --db <path>      SQLite DB (default: data/brain.db)
 *   --verbose        Log per-entity drift details
 *
 * Exit codes:
 *   0 — parity confirmed
 *   1 — drift detected
 *   2 — missing file / fatal error
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JsonlProvider } from './lib/memory/jsonl-provider.mjs';
import { SqliteProvider } from './lib/memory/sqlite-backend.mjs';
import { checkParity } from './lib/memory/parity-checker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
function flag(name) { return args.includes(name); }

const jsonlPath = opt('--jsonl', join(ROOT, 'data', 'brain.jsonl'));
const dbPath    = opt('--db',   join(ROOT, 'data', 'brain.db'));
const verbose   = flag('--verbose');

// ── Validation ───────────────────────────────────────────────────────────────

if (!existsSync(jsonlPath)) {
  console.error(`Error: JSONL file not found: ${jsonlPath}`);
  process.exit(2);
}
if (!existsSync(dbPath)) {
  console.error(`Error: DB file not found: ${dbPath}`);
  process.exit(2);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`hermit-verify: ${jsonlPath} ↔ ${dbPath}`);

  const t0 = Date.now();

  const jsonlProvider = new JsonlProvider({ brainPath: jsonlPath });
  const sqliteProvider = new SqliteProvider({ dbPath });

  const [jsonlData, sqliteData] = await Promise.all([
    jsonlProvider.readAll(),
    sqliteProvider.readAll(),
  ]);

  const { parity, report } = checkParity(jsonlData, sqliteData);
  const elapsedMs = Date.now() - t0;

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log(`\nParity check (${elapsedMs}ms):`);
  console.log(`  entities  — jsonl: ${report.totalEntitiesJsonl}, sqlite: ${report.totalEntitiesSqlite}`);
  console.log(`  relations — jsonl: ${report.totalRelationsJsonl}, sqlite: ${report.totalRelationsSqlite}`);

  if (report.missingInDb.length > 0) {
    console.log(`\n  missing in DB (${report.missingInDb.length}):`);
    for (const n of report.missingInDb.slice(0, 20)) console.log(`    - ${n}`);
    if (report.missingInDb.length > 20) console.log(`    … and ${report.missingInDb.length - 20} more`);
  }

  if (report.missingInJsonl.length > 0) {
    console.log(`\n  missing in JSONL (${report.missingInJsonl.length}):`);
    for (const n of report.missingInJsonl.slice(0, 20)) console.log(`    - ${n}`);
    if (report.missingInJsonl.length > 20) console.log(`    … and ${report.missingInJsonl.length - 20} more`);
  }

  if (report.missingRelationsInDb.length > 0) {
    console.log(`\n  relations missing in DB: ${report.missingRelationsInDb.length}`);
    if (verbose) for (const k of report.missingRelationsInDb.slice(0, 10)) console.log(`    - ${k}`);
  }

  if (report.missingRelationsInJsonl.length > 0) {
    console.log(`\n  relations missing in JSONL: ${report.missingRelationsInJsonl.length}`);
    if (verbose) for (const k of report.missingRelationsInJsonl.slice(0, 10)) console.log(`    - ${k}`);
  }

  if (report.driftedObservations.length > 0) {
    console.log(`\n  drifted observations (${report.driftedObservations.length} entities):`);
    for (const d of report.driftedObservations.slice(0, 20)) {
      console.log(`    - ${d.entity}: jsonl=${d.jsonlCount} sqlite=${d.sqliteCount}`);
    }
    if (report.driftedObservations.length > 20) {
      console.log(`    … and ${report.driftedObservations.length - 20} more`);
    }
  }

  sqliteProvider.close();

  console.log(`\nResult: ${parity ? 'PARITY OK' : 'DRIFT DETECTED'}`);
  process.exit(parity ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(2);
});
