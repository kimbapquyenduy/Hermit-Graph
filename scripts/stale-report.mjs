/**
 * Stale report: finds observations older than threshold (default 180 days).
 *
 * Usage: node scripts/stale-report.mjs [threshold_days]
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseObservation, isStale, staleDays } from './lib/parse-observation.mjs';

const brainPath = join(process.cwd(), 'data', 'brain.jsonl');
const threshold = parseInt(process.argv[2]) || 180;

if (!existsSync(brainPath)) {
  console.log('No brain.jsonl found at', brainPath);
  process.exit(1);
}

const content = readFileSync(brainPath, 'utf-8');
const lines = content.trim().split('\n').filter(l => l.trim());

const entities = lines
  .map(l => JSON.parse(l))
  .filter(d => d.type === 'entity');

let totalDated = 0;
let totalStale = 0;
const staleEntities = [];

for (const entity of entities) {
  const staleObs = [];
  for (const obs of entity.observations || []) {
    const parsed = parseObservation(obs);
    if (parsed.date) {
      totalDated++;
      if (isStale(parsed.date, threshold)) {
        totalStale++;
        staleObs.push({
          text: parsed.text,
          date: parsed.date,
          age: staleDays(parsed.date),
          confidence: parsed.confidence
        });
      }
    }
  }
  if (staleObs.length > 0) {
    staleEntities.push({ name: entity.name, observations: staleObs });
  }
}

console.log('Stale Observations Report');
console.log('========================');
console.log(`Threshold: ${threshold} days\n`);

if (staleEntities.length === 0) {
  console.log('No stale observations found.');
  console.log(`(${totalDated} dated observations checked)`);
} else {
  for (const entity of staleEntities) {
    console.log(`Entity: ${entity.name}`);
    for (const obs of entity.observations) {
      console.log(`  [${obs.confidence}|${obs.date}] ${obs.text} — ${obs.age} days old`);
    }
    console.log();
  }
  console.log(`Total: ${totalStale} stale observations across ${staleEntities.length} entities`);
  console.log(`(out of ${totalDated} dated observations)`);
  console.log('\nRecommendation: Run /brain-dump to review and update');
}
