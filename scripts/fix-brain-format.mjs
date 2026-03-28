#!/usr/bin/env node
/**
 * fix-brain-format.mjs
 *
 * Normalizes brain.jsonl observations to plain strings.
 * Converts object observations {content, timestamp, confidence} → "[confidence|YYYY-MM-DD] content"
 * Preserves plain string observations as-is.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

const BRAIN_PATH = join(import.meta.dirname, '..', 'data', 'brain.jsonl');
const BACKUP_PATH = BRAIN_PATH + '.backup-' + new Date().toISOString().replace(/[:.]/g, '-');

// Read and parse
const raw = readFileSync(BRAIN_PATH, 'utf-8').trim();
const lines = raw.split('\n');

let stats = {
  totalLines: lines.length,
  entities: 0,
  relations: 0,
  objectObservations: 0,
  stringObservations: 0,
  mixedEntities: 0,
  convertedObservations: 0,
  errors: []
};

const fixedLines = lines.map((line, idx) => {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch (e) {
    stats.errors.push(`Line ${idx + 1}: JSON parse error - ${e.message}`);
    return line; // keep as-is
  }

  if (obj.type === 'relation') {
    stats.relations++;
    return line; // relations don't have observations
  }

  if (obj.type === 'entity') {
    stats.entities++;

    if (!obj.observations || !Array.isArray(obj.observations) || obj.observations.length === 0) {
      return JSON.stringify(obj);
    }

    let hasObjects = false;
    let hasStrings = false;

    for (const obs of obj.observations) {
      if (typeof obs === 'object' && obs !== null && 'content' in obs) {
        hasObjects = true;
      } else if (typeof obs === 'string') {
        hasStrings = true;
      }
    }

    if (hasObjects && hasStrings) stats.mixedEntities++;

    if (hasObjects) {
      // Convert object observations to strings
      obj.observations = obj.observations.map(obs => {
        if (typeof obs === 'string') {
          stats.stringObservations++;
          return obs; // already a string
        }

        if (typeof obs === 'object' && obs !== null && 'content' in obs) {
          stats.objectObservations++;
          stats.convertedObservations++;

          const content = obs.content;
          const confidence = obs.confidence || 0.8;
          const timestamp = obs.timestamp;

          // Check if content already has [confidence|date] prefix
          if (/^\[[\d.]+\|\d{4}-\d{2}-\d{2}\]/.test(content)) {
            return content; // already prefixed
          }

          // Format date from timestamp
          let dateStr = '2026-03-27'; // fallback
          if (timestamp) {
            const d = new Date(timestamp);
            dateStr = d.toISOString().slice(0, 10);
          }

          return `[${confidence}|${dateStr}] ${content}`;
        }

        // Unknown format, stringify
        stats.errors.push(`Line ${idx + 1}: Unknown observation format: ${JSON.stringify(obs)}`);
        return String(obs);
      });
    } else {
      // All strings already
      stats.stringObservations += obj.observations.length;
    }

    return JSON.stringify(obj);
  }

  return line; // unknown type, keep as-is
});

// Report
console.log('=== brain.jsonl Analysis & Fix Report ===');
console.log(`Total lines: ${stats.totalLines}`);
console.log(`Entities: ${stats.entities}`);
console.log(`Relations: ${stats.relations}`);
console.log(`Object observations found: ${stats.objectObservations}`);
console.log(`String observations found: ${stats.stringObservations}`);
console.log(`Mixed-format entities: ${stats.mixedEntities}`);
console.log(`Observations converted: ${stats.convertedObservations}`);
if (stats.errors.length > 0) {
  console.log(`\nErrors (${stats.errors.length}):`);
  stats.errors.forEach(e => console.log(`  - ${e}`));
}

// Backup and write
console.log(`\nBacking up to: ${BACKUP_PATH}`);
copyFileSync(BRAIN_PATH, BACKUP_PATH);

const output = fixedLines.join('\n') + '\n';
writeFileSync(BRAIN_PATH, output, 'utf-8');
console.log(`Fixed brain.jsonl written (${output.length} bytes)`);

// Verify by re-reading
const verify = readFileSync(BRAIN_PATH, 'utf-8').trim().split('\n');
let verifyOk = true;
for (let i = 0; i < verify.length; i++) {
  const obj = JSON.parse(verify[i]);
  if (obj.type === 'entity' && obj.observations) {
    for (const obs of obj.observations) {
      if (typeof obs !== 'string') {
        console.log(`VERIFY FAIL: Line ${i + 1} entity "${obj.name}" still has non-string observation`);
        verifyOk = false;
      }
    }
  }
}
console.log(`\nVerification: ${verifyOk ? 'PASS - all observations are plain strings' : 'FAIL - some observations still non-string'}`);
