#!/usr/bin/env node
/**
 * Brain Health Check — 5 automated quality checks on knowledge graph
 * Usage: node scripts/brain-health.mjs [path-to-brain.jsonl]
 * Exit code: 0 if healthy (>70), 1 if unhealthy
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseObservation, isStale } from './lib/parse-observation.mjs';

// Stop words for missing-relation heuristic
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
  'not', 'no', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'than', 'too', 'very', 'just', 'about',
  'min', 'max', 'new', 'old', 'use', 'used', 'using'
]);

function loadBrain(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(l => l.trim());
  const entities = [];
  const relations = [];
  for (const line of lines) {
    const data = JSON.parse(line);
    if (data.type === 'entity') entities.push(data);
    if (data.type === 'relation') relations.push(data);
  }
  return { entities, relations };
}

// Check 1: Stale entries (>180 days old)
function checkStale(entities) {
  let dated = 0, staleCount = 0;
  const staleItems = [];
  for (const e of entities) {
    for (const obs of e.observations || []) {
      const parsed = parseObservation(obs);
      if (parsed.date) {
        dated++;
        if (isStale(parsed.date, 180)) {
          staleCount++;
          staleItems.push({ entity: e.name, text: parsed.text.slice(0, 60) });
        }
      }
    }
  }
  if (dated === 0) return { name: 'Stale Entries', skipped: true, reason: 'No dated observations', weight: 0.20 };
  return {
    name: 'Stale Entries',
    passed: staleCount / dated < 0.05,
    violationCount: staleCount,
    totalCount: dated,
    weight: 0.20,
    items: staleItems
  };
}

// Check 2: Duplicate entity names
function checkDuplicates(entities) {
  const seen = new Map();
  const dupes = [];
  for (const e of entities) {
    const key = e.name.toLowerCase();
    if (seen.has(key)) {
      dupes.push({ name: e.name, existingName: seen.get(key) });
    } else {
      seen.set(key, e.name);
    }
  }
  return {
    name: 'Duplicates',
    passed: dupes.length === 0,
    violationCount: dupes.length,
    totalCount: entities.length,
    weight: 0.25,
    items: dupes
  };
}

// Check 3: Orphan nodes (entities with 0 relations)
function checkOrphans(entities, relations) {
  const linked = new Set();
  for (const r of relations) {
    linked.add(r.from);
    linked.add(r.to);
  }
  const orphans = entities.filter(e => !linked.has(e.name));
  return {
    name: 'Orphan Nodes',
    passed: entities.length === 0 || orphans.length / entities.length < 0.1,
    violationCount: orphans.length,
    totalCount: entities.length,
    weight: 0.20,
    items: orphans.map(e => ({ name: e.name }))
  };
}

// Check 4: Low confidence observations (<0.3)
function checkLowConfidence(entities) {
  let total = 0, lowCount = 0;
  const lowItems = [];
  let hasConfidence = false;
  for (const e of entities) {
    for (const obs of e.observations || []) {
      const parsed = parseObservation(obs);
      if (obs.startsWith('[')) hasConfidence = true;
      total++;
      if (parsed.confidence < 0.3) {
        lowCount++;
        lowItems.push({ entity: e.name, confidence: parsed.confidence, text: parsed.text.slice(0, 60) });
      }
    }
  }
  if (!hasConfidence) return { name: 'Low Confidence', skipped: true, reason: 'No confidence data', weight: 0.20 };
  return {
    name: 'Low Confidence',
    passed: total === 0 || lowCount / total < 0.15,
    violationCount: lowCount,
    totalCount: total,
    weight: 0.20,
    items: lowItems
  };
}

// Check 5: Missing relations (heuristic: shared keyword tokens)
function checkMissingRelations(entities, relations) {
  function extractTokens(entity) {
    const parts = [entity.name, ...(entity.observations || [])].join(' ');
    return [...new Set(
      parts.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    )];
  }

  const relationSet = new Set();
  for (const r of relations) {
    relationSet.add(`${r.from}|||${r.to}`);
    relationSet.add(`${r.to}|||${r.from}`);
  }

  let missing = 0, checked = 0;
  const missingItems = [];
  const cap = Math.min(entities.length, 500);
  for (let i = 0; i < cap; i++) {
    const tokensI = extractTokens(entities[i]);
    for (let j = i + 1; j < cap; j++) {
      const tokensJ = extractTokens(entities[j]);
      const shared = tokensI.filter(t => tokensJ.includes(t));
      if (shared.length >= 2) {
        checked++;
        const key = `${entities[i].name}|||${entities[j].name}`;
        if (!relationSet.has(key)) {
          missing++;
          if (missingItems.length < 10) {
            missingItems.push({ from: entities[i].name, to: entities[j].name, shared: shared.slice(0, 3) });
          }
        }
      }
    }
  }
  return {
    name: 'Missing Relations',
    passed: checked === 0 || (1 - missing / checked) > 0.8,
    violationCount: missing,
    totalCount: checked,
    weight: 0.15,
    items: missingItems
  };
}

// Scoring formula
function calculateHealth(checks) {
  let penalty = 0;
  for (const check of checks) {
    if (check.skipped || check.passed) continue;
    const ratio = check.totalCount > 0 ? check.violationCount / check.totalCount : 0;
    penalty += check.weight * Math.min(ratio * 2, 1);
  }
  return Math.round((1 - penalty) * 100);
}

function statusLabel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 70) return 'Healthy';
  if (score >= 50) return 'Needs Attention';
  return 'Unhealthy';
}

// Export for test usage
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
