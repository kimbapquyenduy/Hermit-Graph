/**
 * Backfill script: adds [0.8] prefix to existing observations without prefix.
 * Creates backup before modifying. Safe to run multiple times (idempotent).
 *
 * Usage: node scripts/backfill-confidence.mjs
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';
import { todayISO, obsText } from './lib/parse-observation.mjs';

const brainPath = join(process.cwd(), 'data', 'brain.jsonl');
const backupPath = brainPath + '.bak';

if (!existsSync(brainPath)) {
  console.log('No brain.jsonl found at', brainPath);
  process.exit(1);
}

// Backup first
copyFileSync(brainPath, backupPath);
console.log('Backup created:', backupPath);

const content = readFileSync(brainPath, 'utf-8');
const lines = content.trim().split('\n').filter(l => l.trim());

let entityCount = 0;
let obsCount = 0;
const today = todayISO();

const updated = lines.map(line => {
  const data = JSON.parse(line);
  if (data.type !== 'entity' || !data.observations) return line;

  let modified = false;
  data.observations = data.observations.map(obs => {
    const text = obsText(obs);
    // Skip if already has prefix [
    if (text.startsWith('[')) return obs;
    obsCount++;
    modified = true;
    // Preserve object format if present
    if (typeof obs === 'object' && obs.content) {
      return { ...obs, content: `[0.8|${today}] ${obs.content}` };
    }
    return `[0.8|${today}] ${text}`;
  });

  if (modified) entityCount++;
  return JSON.stringify(data);
});

writeFileSync(brainPath, updated.join('\n') + '\n', 'utf-8');
console.log(`Backfilled ${obsCount} observations across ${entityCount} entities`);
console.log('Default confidence: 0.8 | Date:', today);
