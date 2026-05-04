#!/usr/bin/env node
/**
 * migrate-jsonl-to-sqlite.mjs — One-shot offline migration from brain.jsonl → brain.db.
 * Streams JSONL via readline (memory-bounded). Batches 200 rows per transaction.
 * Idempotent: re-running UPSERTs cleanly — zero duplicates.
 *
 * Usage:
 *   node scripts/migrate-jsonl-to-sqlite.mjs [options]
 *
 * Options:
 *   --from <path>       Source JSONL (default: data/brain.jsonl)
 *   --to <path>         Target SQLite DB (default: data/brain.db)
 *   --dry-run           Report counts without writing DB
 *   --batch-size <n>    Rows per transaction (default: 200)
 *   --verbose           Log every entity/relation processed
 */

import { createReadStream, existsSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SqliteProvider } from './lib/memory/sqlite-backend.mjs';
import {
  prepareStatements,
  writeEntityInTx,
} from './lib/memory/sqlite-write-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name) { return args.includes(name); }
function opt(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

const fromPath = opt('--from', join(ROOT, 'data', 'brain.jsonl'));
const toPath   = opt('--to',   join(ROOT, 'data', 'brain.db'));
const dryRun   = flag('--dry-run');
const verbose  = flag('--verbose');
const batchSize = parseInt(opt('--batch-size', '200'), 10) || 200;

// ── Validation ───────────────────────────────────────────────────────────────

if (!existsSync(fromPath)) {
  console.error(`Error: source file not found: ${fromPath}`);
  process.exit(1);
}

// ── Dry-run: count only ───────────────────────────────────────────────────────

async function countOnly(jsonlPath) {
  let entities = 0, relations = 0, observations = 0, parseErrors = 0;
  const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'entity') {
        entities++;
        observations += (obj.observations || []).length;
      } else if (obj.type === 'relation') {
        relations++;
      }
    } catch (err) {
      parseErrors++;
      console.error(`  parse error at line ${lineNo}: ${err.message}`);
    }
  }
  return { entities, relations, observations, parseErrors };
}

// ── Migration ─────────────────────────────────────────────────────────────────

/**
 * Flush a batch: entities first, then relations, all in one transaction.
 * @param {object} db  - better-sqlite3 Database instance
 * @param {object} stmts - prepared statements
 * @param {object[]} entityBatch
 * @param {object[]} relationBatch
 */
function flushBatch(db, stmts, entityBatch, relationBatch) {
  const tx = db.transaction(() => {
    for (const entity of entityBatch) writeEntityInTx(stmts, entity);
    for (const rel of relationBatch) {
      stmts.upsertRelation.run({
        fromName: rel.from,
        toName: rel.to,
        relationType: rel.relationType,
      });
    }
  });
  tx();
}

async function migrate(jsonlPath, dbPath) {
  const provider = new SqliteProvider({ dbPath });
  // Access internal db + stmts directly — provider.writeEntity wraps each in its own tx,
  // which is too slow for bulk migration. We use batch transactions instead.
  const db    = provider._db;
  const stmts = prepareStatements(db);

  let entityCount = 0, relationCount = 0, obsCount = 0, parseErrors = 0;
  let entityBatch = [], relationBatch = [], linesProcessed = 0;

  const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });
  let lineNo = 0;

  for await (const line of rl) {
    lineNo++;
    if (!line.trim()) continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      parseErrors++;
      console.error(`  parse error at line ${lineNo}: ${err.message}`);
      continue;
    }

    if (obj.type === 'entity') {
      entityBatch.push(obj);
      obsCount += (obj.observations || []).length;
      entityCount++;
      if (verbose) console.log(`  entity: ${obj.name}`);
    } else if (obj.type === 'relation') {
      relationBatch.push(obj);
      relationCount++;
      if (verbose) console.log(`  relation: ${obj.from} -[${obj.relationType}]-> ${obj.to}`);
    }

    linesProcessed++;

    // Flush when batch is full
    if (entityBatch.length + relationBatch.length >= batchSize) {
      flushBatch(db, stmts, entityBatch, relationBatch);
      entityBatch = [];
      relationBatch = [];
    }

    // Progress for large vaults
    if (linesProcessed % 500 === 0 && entityCount > 1000) {
      console.log(`  progress: ${entityCount} entities, ${relationCount} relations processed…`);
    }
  }

  // Flush remainder
  if (entityBatch.length > 0 || relationBatch.length > 0) {
    flushBatch(db, stmts, entityBatch, relationBatch);
  }

  // Rebuild FTS5 index to ensure consistency after bulk load
  db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`);

  provider.close();
  return { entityCount, relationCount, obsCount, parseErrors };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`hermit-migrate: ${dryRun ? '[DRY RUN] ' : ''}${fromPath} → ${toPath}`);

  if (dryRun) {
    console.log('Counting (dry-run)…');
    const counts = await countOnly(fromPath);
    console.log(`  entities:    ${counts.entities}`);
    console.log(`  relations:   ${counts.relations}`);
    console.log(`  observations:${counts.observations}`);
    console.log(`  parse errors:${counts.parseErrors}`);
    console.log('Dry run complete — no DB written.');
    process.exit(counts.parseErrors > 0 ? 2 : 0);
  }

  const t0 = Date.now();
  const result = await migrate(fromPath, toPath);
  const elapsedMs = Date.now() - t0;

  console.log(`Migration complete in ${elapsedMs}ms`);
  console.log(`  entities:    ${result.entityCount}`);
  console.log(`  relations:   ${result.relationCount}`);
  console.log(`  observations:${result.obsCount}`);
  if (result.parseErrors > 0) {
    console.error(`  parse errors:${result.parseErrors} (see above)`);
    process.exit(2);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
