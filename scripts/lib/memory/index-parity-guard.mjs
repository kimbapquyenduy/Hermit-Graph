/**
 * index-parity-guard.mjs — keep the SQLite index in step with brain.jsonl.
 *
 * ARCHITECTURE DECISION (2026-09-07): brain.jsonl is the SOURCE OF TRUTH;
 * brain.db is a DERIVED INDEX.
 *
 * Why truth lives in JSONL:
 *  - 11 consumers read it directly and structurally cannot use SQLite: the
 *    per-prompt kg-* hooks (short-lived .cjs spawned by every agent), the
 *    browser viewers (plain HTML), brain-cli, merge-brain-jsonl, view-graph.
 *  - It is git-diffable, human-inspectable, and mergeable across machines
 *    (merge-brain-jsonl.mjs exists precisely for that).
 *  - Rebuilding the index from truth costs ~450ms on a ~900-entity vault.
 *    Rebuilding truth from an index is a data-loss risk.
 *
 * Why SQLite stays: FTS, vector search and indexed lookups. That is index
 * value, not authority value.
 *
 * The split-brain incident (writes to JSONL, reads from SQLite, mirror silently
 * skipped) happened because authority was ambiguous. Naming one owner removes
 * the ambiguity; this guard removes the whole failure MODE, by detecting drift
 * at boot and rebuilding the index from truth before anything reads it.
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** Skip healing above this many entities unless forced — keeps boot snappy. */
const MAX_AUTO_HEAL_ENTITIES = Number(process.env.HERMIT_MAX_AUTO_HEAL || 20_000);

/**
 * Count entities and relations in a JSONL vault.
 *
 * Counts ALL records, archived included: the question this guard answers is
 * "does the index faithfully mirror the file", and the migration writes
 * archived records too. Filtering them here would report permanent false drift
 * (measured: 843 active vs 879 total on this vault).
 * @param {string} brainPath
 * @returns {{ entities: number, relations: number }}
 */
export function countJsonl(brainPath) {
  if (!existsSync(brainPath)) return { entities: 0, relations: 0 };
  let entities = 0, relations = 0;
  const content = readFileSync(brainPath, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.type === 'entity') entities++;
      else if (rec.type === 'relation') relations++;
    } catch { /* skip malformed */ }
  }
  return { entities, relations };
}

/**
 * Count rows in the SQLite index.
 * @param {string} dbPath
 * @returns {{ entities: number, relations: number }}
 */
export function countSqlite(dbPath) {
  if (!existsSync(dbPath)) return { entities: 0, relations: 0 };
  let db;
  try {
    const Database = require('better-sqlite3');
    db = Database(dbPath, { readonly: true });
    const one = (tbl) => {
      try { return db.prepare(`select count(*) c from ${tbl}`).get().c; }
      catch { return 0; }
    };
    return { entities: one('entities'), relations: one('relations') };
  } catch {
    // Unreadable / not yet initialized — treat as empty so drift is detected.
    return { entities: 0, relations: 0 };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

/**
 * Compare truth against the index.
 * @param {{ brainPath: string, dbPath: string }} paths
 * @returns {{ inSync: boolean, jsonl: object, sqlite: object, reason: string }}
 */
export function checkIndexParity({ brainPath, dbPath }) {
  const jsonl = countJsonl(brainPath);
  const sqlite = countSqlite(dbPath);
  const reasons = [];
  if (jsonl.entities !== sqlite.entities) {
    reasons.push(`entities ${jsonl.entities} vs ${sqlite.entities}`);
  }
  if (jsonl.relations !== sqlite.relations) {
    reasons.push(`relations ${jsonl.relations} vs ${sqlite.relations}`);
  }
  return { inSync: reasons.length === 0, jsonl, sqlite, reason: reasons.join(', ') };
}

/**
 * Rebuild the SQLite index from JSONL truth. Runs the migrate script in a child
 * process so the parent never holds a stale DB handle over the rebuild.
 * @param {{ brainPath: string, dbPath: string, log?: Function }} opts
 * @returns {boolean} true when the rebuild succeeded
 */
export function healIndex({ brainPath, dbPath, log = () => {} }) {
  const script = join(__dirname, '..', '..', 'migrate-jsonl-to-sqlite.mjs');
  if (!existsSync(script)) {
    log(`index-parity: cannot heal — ${script} missing`);
    return false;
  }
  try {
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, [script, '--from', brainPath, '--to', dbPath], {
      stdio: 'ignore',
    });
    return true;
  } catch (err) {
    log(`index-parity: rebuild failed: ${err.message}`);
    return false;
  }
}

/**
 * Boot hook: detect drift and rebuild the index from truth before anything
 * reads it. Must run BEFORE SqliteProvider is constructed.
 * @param {{ brainPath: string, dbPath: string, log?: Function }} opts
 * @returns {{ healed: boolean, checked: object }}
 */
export function ensureIndexParity({ brainPath, dbPath, log = () => {} }) {
  if (process.env.HERMIT_SKIP_PARITY_CHECK === '1') {
    return { healed: false, checked: { inSync: true, reason: 'skipped' } };
  }
  if (!existsSync(brainPath)) {
    // Nothing to derive from — a fresh vault; the index starts empty too.
    return { healed: false, checked: { inSync: true, reason: 'no jsonl yet' } };
  }

  const checked = checkIndexParity({ brainPath, dbPath });
  if (checked.inSync) return { healed: false, checked };

  if (checked.jsonl.entities > MAX_AUTO_HEAL_ENTITIES) {
    log(`index-parity: DRIFT (${checked.reason}) but vault has ${checked.jsonl.entities} entities ` +
        `(> ${MAX_AUTO_HEAL_ENTITIES}) — skipping auto-rebuild. ` +
        'Run: node scripts/migrate-jsonl-to-sqlite.mjs');
    return { healed: false, checked };
  }

  log(`index-parity: DRIFT detected (${checked.reason}) — rebuilding SQLite index from brain.jsonl`);
  const t0 = Date.now();
  const healed = healIndex({ brainPath, dbPath, log });
  if (healed) {
    const after = checkIndexParity({ brainPath, dbPath });
    log(`index-parity: rebuild ${after.inSync ? 'OK' : `INCOMPLETE (${after.reason})`} in ${Date.now() - t0}ms`);
  }
  return { healed, checked };
}
