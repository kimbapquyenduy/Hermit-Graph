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
  checkSchemaConformance, checkDanglingRelations, checkRelationVocabulary,
} from './lib/brain-health-checks.mjs';

/** Render one check finding — item shapes differ per check. */
function describeItem(item) {
  if (item.relationType && item.count !== undefined) {
    return `"${item.relationType}" × ${item.count} (not in canonical vocabulary)`;
  }
  if (item.from && item.to) {
    const detail = item.reasons ? item.reasons.join(', ')
      : item.confidence !== undefined ? `confidence ${item.confidence}; shared: ${(item.shared || []).join(', ')}`
      : item.relationType || '';
    return `${item.from} ↔ ${item.to}${detail ? ` (${detail})` : ''}`;
  }
  if (item.problems) return `${item.name} — ${item.problems.join('; ')}`;
  return item.name || item.entity || JSON.stringify(item);
}

function statusLabel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 70) return 'Healthy';
  if (score >= 50) return 'Needs Attention';
  return 'Unhealthy';
}

// Re-export for backward compatibility (tests import from here)
export {
  loadBrain, checkStale, checkDuplicates, checkOrphans, checkLowConfidence,
  checkMissingRelations, calculateHealth,
  checkSchemaConformance, checkDanglingRelations, checkRelationVocabulary,
};

// CLI entry
const args = process.argv.slice(2);
const brainPath = args[0] || join(process.cwd(), 'data', 'brain.jsonl');

if (!existsSync(brainPath)) {
  console.error(`File not found: ${brainPath}`);
  console.error('Usage: node scripts/brain-health.mjs [path-to-brain.jsonl]');
  process.exit(1);
}

const { entities, relations, archivedNames } = loadBrain(brainPath);

const checks = [
  checkStale(entities),
  checkDuplicates(entities),
  checkOrphans(entities, relations),
  checkLowConfidence(entities),
  checkMissingRelations(entities, relations),
  checkSchemaConformance(entities),
  checkDanglingRelations(entities, relations, archivedNames),
  checkRelationVocabulary(relations),
];

const score = calculateHealth(checks);

// Output report
console.log('Brain Health Report');
console.log('===================');
console.log(`Score: ${score}/100 (${statusLabel(score)})\n`);

for (let i = 0; i < checks.length; i++) {
  const c = checks[i];
  const pct = c.totalCount > 0 ? Math.round(c.violationCount / c.totalCount * 100) : 0;
  if (c.skipped) {
    console.log(`Check ${i + 1}: ${c.name} — SKIP (${c.reason})`);
    continue;
  }
  // Informational checks report findings but don't affect the score.
  const status = c.informational ? 'INFO' : c.passed ? 'PASS' : 'WARN';
  console.log(`Check ${i + 1}: ${c.name} — ${status} (${c.violationCount}/${c.totalCount}, ${pct}%)`);
  if (status === 'PASS') continue;
  for (const item of (c.items || []).slice(0, 5)) {
    console.log(`  → ${describeItem(item)}`);
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
if (!missingCheck.skipped && missingCheck.items?.length) {
  recs.push(`Review ${missingCheck.items.length} suggested relations above (highest-confidence pairs only)`);
}
const schemaCheck = checks[5];
if (!schemaCheck.passed) {
  recs.push(`Fix ${schemaCheck.violationCount} entities violating the schema registry (naming / min observations / required keys)`);
}
const danglingCheck = checks[6];
if (!danglingCheck.passed) {
  recs.push(`Repair ${danglingCheck.violationCount} dangling relations — endpoints missing or archived`);
}
const vocabCheck = checks[7];
if (vocabCheck.violationCount > 0) {
  recs.push(`${vocabCheck.violationCount} relations use ${vocabCheck.distinctOffenders} relationTypes outside the registry — adopt or rename (do not bulk-delete)`);
}

if (recs.length > 0) {
  console.log('\nRecommendations:');
  recs.forEach((r, i) => console.log(`${i + 1}. ${r}`));
}

console.log('\nRun /brain-health in Claude Code for interactive fixes.');
process.exit(score > 70 ? 0 : 1);
