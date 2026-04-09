#!/usr/bin/env node
/**
 * Migrate brain.jsonl from v3 (string observations) to v4 (object observations).
 * Creates backup before modifying. Idempotent — safe to run multiple times.
 *
 * Usage: node scripts/migrate-v3-to-v4.mjs [path-to-brain.jsonl]
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { resolveBrainPath } from './lib/resolve-brain-path.mjs';

const brainPath = process.argv[2] || resolveBrainPath();
const backupPath = brainPath + '.v3-backup';

if (!existsSync(brainPath)) {
  console.error(`File not found: ${brainPath}`);
  console.error('Usage: node scripts/migrate-v3-to-v4.mjs [path-to-brain.jsonl]');
  process.exit(1);
}

// Step 1: Backup (only once — don't overwrite existing backup)
if (!existsSync(backupPath)) {
  copyFileSync(brainPath, backupPath);
  console.log(`Backup created: ${backupPath}`);
} else {
  console.log(`Backup already exists: ${backupPath}`);
}

// Step 2: Read + migrate
const lines = readFileSync(brainPath, 'utf-8').split('\n').filter(Boolean);
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
