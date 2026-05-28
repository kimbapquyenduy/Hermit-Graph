#!/usr/bin/env node
/**
 * Migrate brain.jsonl from v3 (string observations) to v4 (object observations).
 * Creates backup before modifying. Idempotent — safe to run multiple times.
 *
 * Usage: node scripts/migrate-v3-to-v4.mjs [path-to-brain.jsonl]
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, createReadStream } from 'fs';
import { createInterface } from 'readline';
import { resolveBrainPath } from './lib/resolve-brain-path.mjs';

const rawArgs = process.argv.slice(2);
const skipConfirm = rawArgs.includes('--yes');
// Filter out flags to find positional path arg
const brainPath = rawArgs.filter(a => !a.startsWith('--'))[0] || resolveBrainPath();
const backupPath = brainPath + '.v3-backup';

if (!existsSync(brainPath)) {
  console.error(`File not found: ${brainPath}`);
  console.error('Usage: node scripts/migrate-v3-to-v4.mjs [path-to-brain.jsonl] [--yes]');
  process.exit(1);
}

// Count entities for confirmation prompt
const lines = readFileSync(brainPath, 'utf-8').split('\n').filter(Boolean);
const entityCount = lines.filter(l => { try { return JSON.parse(l).type === 'entity'; } catch { return false; } }).length;

// Step 0: Confirmation prompt (unless --yes or non-TTY)
if (!skipConfirm && process.stdin.isTTY) {
  const answer = await new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`About to migrate ${entityCount} entities at ${brainPath}. Continue? [y/N] `, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    });
  });
  if (answer !== 'y' && answer !== 'yes') {
    console.log('Migration aborted. Re-run with --yes to skip this prompt.');
    process.exit(0);
  }
} else if (!skipConfirm && !process.stdin.isTTY) {
  console.log(`Migrating ${entityCount} entities at ${brainPath} (non-interactive — add --yes to confirm explicitly).`);
}

// Step 1: Backup (only once — don't overwrite existing backup)
if (!existsSync(backupPath)) {
  copyFileSync(brainPath, backupPath);
  console.log(`Backup created: ${backupPath}`);
} else {
  console.log(`Backup already exists: ${backupPath}`);
}

// Step 2: Read + migrate
let migratedEntities = 0, migratedObs = 0, alreadyMigrated = 0;

const migrated = lines.map(line => {
  const obj = JSON.parse(line);
  if (obj.type === 'entity') {
    obj.observations = (obj.observations || []).map(obs => {
      if (typeof obs === 'string') {
        migratedObs++;
        return { content: obs, _branch: null, _archived: false, _archivedAt: null, _history: [] };
      }
      // Already object — ensure all v4 fields present
      alreadyMigrated++;
      return {
        content: obs.content ?? (typeof obs === 'string' ? obs : ''),
        _branch: obs._branch ?? null,
        _archived: obs._archived ?? false,
        _archivedAt: obs._archivedAt ?? null,
        _history: obs._history ?? [],
      };
    });
    migratedEntities++;
  }
  return JSON.stringify(obj);
});

// Step 3: Write
writeFileSync(brainPath, migrated.join('\n') + '\n');

// Step 4: Validate
const check = readFileSync(brainPath, 'utf-8').split('\n').filter(Boolean);
let parseErrors = 0;
for (const [i, line] of check.entries()) {
  try { JSON.parse(line); } catch { parseErrors++; console.error(`Validation error at line ${i + 1}`); }
}
if (parseErrors > 0) {
  console.error(`${parseErrors} parse errors found. Restore backup: cp ${backupPath} ${brainPath}`);
  process.exit(1);
}

console.log(`Migrated ${migratedEntities} entities (${migratedObs} string→object, ${alreadyMigrated} already v4).`);
console.log('Migration complete.');
