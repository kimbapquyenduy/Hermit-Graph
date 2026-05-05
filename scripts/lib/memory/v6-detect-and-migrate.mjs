/**
 * v6-detect-and-migrate.mjs — Boot helper: detect v6 vault state, auto-migrate to v7.
 *
 * Called once on MCP server boot. Non-destructive: original JSONL renamed to
 * `.v6-backup-{date}`, never deleted.
 *
 * States:
 *   'v7'              — brain.db present → use directly
 *   'v6-needs-migrate' — brain.jsonl exists but brain.db missing → auto-migrate
 *   'fresh'           — neither exists → fresh install, create on first write
 */

import { existsSync, renameSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';
import { join } from 'path';

/**
 * Detect current vault state.
 *
 * @param {{ brainPath: string, dbPath: string }} opts
 * @returns {'v7' | 'v6-needs-migrate' | 'fresh'}
 */
export function detectVaultState({ brainPath, dbPath }) {
  const hasDb = existsSync(dbPath);
  const hasJsonl = existsSync(brainPath);

  if (hasDb) return 'v7';
  if (hasJsonl && !hasDb) return 'v6-needs-migrate';
  return 'fresh';
}

/**
 * Count entity lines in a JSONL file (fast, no full parse).
 * @param {string} jsonlPath
 * @returns {Promise<number>}
 */
async function countJsonlEntities(jsonlPath) {
  let count = 0;
  const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });
  for await (const line of rl) {
    try {
      const obj = JSON.parse(line.trim());
      if (obj.type === 'entity') count++;
    } catch { /* skip malformed */ }
  }
  return count;
}

/**
 * Prompt user interactively (TTY only). Returns true if user confirms.
 * Defaults to YES on empty input or after 10s timeout.
 *
 * @param {string} question
 * @returns {Promise<boolean>}
 */
async function promptConfirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const timer = setTimeout(() => {
      rl.close();
      resolve(true); // default yes on timeout
    }, 10000);

    process.stderr.write(`${question} [Y/n] `);
    rl.once('line', (answer) => {
      clearTimeout(timer);
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes');
    });
  });
}

/**
 * Run v6 → v7 migration: JSONL → SQLite + vec_entities backfill.
 * Backs up original JSONL before migration. Non-destructive.
 *
 * @param {{
 *   brainPath: string,
 *   dbPath: string,
 *   log: (msg: string) => void
 * }} opts
 * @returns {Promise<{ migrated: boolean, entityCount: number, backupPath: string }>}
 */
export async function autoMigrate({ brainPath, dbPath, log }) {
  log('v6-detect-migrate: Starting v6 → v7 migration...');

  // Count entities for progress reporting
  const entityCount = await countJsonlEntities(brainPath);
  log(`v6-detect-migrate: ${entityCount} entities in ${brainPath}`);

  // Check if user wants to proceed (only when interactive AND not forced)
  const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
  const autoMigrate = process.env.HERMIT_AUTO_MIGRATE === '1';

  if (isInteractive && !autoMigrate) {
    const ok = await promptConfirm(
      `[hermit] Detected v6 vault (${entityCount} entities). Auto-migrate to v7 SQLite?`
    );
    if (!ok) {
      log('v6-detect-migrate: Migration declined by user. Set HERMIT_AUTO_MIGRATE=1 to skip prompt.');
      return { migrated: false, entityCount, backupPath: '' };
    }
  }

  // Backup JSONL before any mutation
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const backupPath = `${brainPath}.v6-backup-${dateTag}`;
  if (!existsSync(backupPath)) {
    // Use copy approach: keep original, write backup
    const { copyFileSync } = await import('fs');
    copyFileSync(brainPath, backupPath);
    log(`v6-detect-migrate: Backed up to ${backupPath}`);
  }

  // Run JSONL → SQLite migration
  try {
    const { execFileSync } = await import('child_process');
    const { fileURLToPath } = await import('url');
    const { dirname } = await import('path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const migrateScript = join(__dirname, '..', '..', 'migrate-jsonl-to-sqlite.mjs');

    execFileSync(process.execPath, [migrateScript, '--from', brainPath, '--to', dbPath], {
      stdio: 'inherit',
    });
    log('v6-detect-migrate: JSONL → SQLite migration complete.');
  } catch (err) {
    log(`v6-detect-migrate: Migration failed: ${err.message}. Vault unchanged. Restore: ${backupPath}`);
    return { migrated: false, entityCount, backupPath };
  }

  // Best-effort vec_entities backfill (non-fatal)
  try {
    const { execFileSync } = await import('child_process');
    const { fileURLToPath } = await import('url');
    const { dirname } = await import('path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const vecScript = join(__dirname, '..', '..', 'migrate-embeddings-to-vec.mjs');

    log('v6-detect-migrate: Backfilling vec_entities (embedding model required)...');
    execFileSync(process.execPath, [vecScript, '--from-jsonl', brainPath, '--db', dbPath], {
      stdio: 'inherit',
    });
    log('v6-detect-migrate: vec_entities backfill complete.');
  } catch (err) {
    log(`v6-detect-migrate: vec_entities backfill failed (non-fatal): ${err.message}`);
    log('v6-detect-migrate: Run `hermit-migrate-vec` manually to backfill embeddings.');
  }

  log(`v6-detect-migrate: v7 migration complete. Original JSONL backed up at ${backupPath}`);
  log('v6-detect-migrate: Run `hermit-export-jsonl` if you need JSONL exports.');
  return { migrated: true, entityCount, backupPath };
}
