#!/usr/bin/env node
/**
 * Brain Health Check — CLI entry point.
 * Usage: node scripts/brain-health.mjs [path-to-brain.jsonl]
 * Exit code: 0 if healthy (>70), 1 if unhealthy
 *
 * Core logic lives in lib/brain-health-checks.mjs (no side effects).
 */

import { existsSync } from 'fs';
import { join } from 'path';
import {
  loadBrain, checkStale, checkDuplicates, checkOrphans,
  checkLowConfidence, checkMissingRelations, calculateHealth,
} from './lib/brain-health-checks.mjs';

function statusLabel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 70) return 'Healthy';
  if (score >= 50) return 'Needs Attention';
  return 'Unhealthy';
}

// Re-export for backward compatibility (tests import from here)
export { loadBrain, checkStale, checkDuplicates, checkOrphans, checkLowConfidence, checkMissingRelations, calculateHealth };

// CLI entry
const args = process.argv.slice(2);
const brainPath = args[0] || join(process.cwd(), 'data', 'brain.jsonl');

if (!existsSync(brainPath)) {
  console.error(`File not found: ${brainPath}`);
  console.error('Usage: node scripts/brain-health.mjs [path-to-brain.jsonl]');
  process.exit(1);
}

const { entities, relations } = loadBrain(brainPath);

const checks = [
  checkStale(entities),
  checkDuplicates(entities),
  checkOrphans(entities, relations),
  checkLowConfidence(entities),
  checkMissingRelations(entities, relations)
];

const score = calculateHealth(checks);

// Output report
console.log('Brain Health Report');
console.log('===================');
console.log(`Score: ${score}/100 (${statusLabel(score)})\n`);

for (let i = 0; i < checks.length; i++) {
  const c = checks[i];
  if (c.skipped) {
    console.log(`Check ${i + 1}: ${c.name} — SKIP (${c.reason})`);
  } else if (c.passed) {
    const pct = c.totalCount > 0 ? Math.round(c.violationCount / c.totalCount * 100) : 0;
    console.log(`Check ${i + 1}: ${c.name} — PASS (${c.violationCount}/${c.totalCount}, ${pct}%)`);
  } else {
    const pct = c.totalCount > 0 ? Math.round(c.violationCount / c.totalCount * 100) : 0;
    console.log(`Check ${i + 1}: ${c.name} — WARN (${c.violationCount}/${c.totalCount}, ${pct}%)`);
    if (c.items && c.items.length > 0) {
      for (const item of c.items.slice(0, 5)) {
        const desc = item.name || item.entity || `${item.from} ↔ ${item.to}`;
        console.log(`  → ${desc}`);
      }
    }
  }
}

// Recommendations
const recs = [];
const orphanCheck = checks[2];
if (!orphanCheck.skipped && !orphanCheck.passed) {
  recs.push(`Link ${orphanCheck.violationCount} orphan entities to parent projects using /remember`);
}
const staleCheck = checks[0];
if (!staleCheck.skipped && !staleCheck.passed) {
  recs.push(`Review ${staleCheck.violationCount} stale entries using /brain-dump`);
}
const lowCheck = checks[3];
if (!lowCheck.skipped && !lowCheck.passed) {
  recs.push(`Confirm ${lowCheck.violationCount} low-confidence observations`);
}
const dupeCheck = checks[1];
if (!dupeCheck.skipped && !dupeCheck.passed) {
  recs.push(`Merge ${dupeCheck.violationCount} duplicate entities`);
}
const missingCheck = checks[4];
if (!missingCheck.skipped && !missingCheck.passed) {
  recs.push(`Add relations for ${missingCheck.violationCount} potentially unlinked entity pairs`);
}

if (recs.length > 0) {
  console.log('\nRecommendations:');
  recs.forEach((r, i) => console.log(`${i + 1}. ${r}`));
}

console.log('\nRun /brain-health in Claude Code for interactive fixes.');
process.exit(score > 70 ? 0 : 1);
