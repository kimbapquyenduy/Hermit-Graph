/**
 * Brain Health Check functions — pure logic, no CLI side effects.
 * Extracted from brain-health.mjs for reuse in MCP tools.
 */

import { readFileSync } from 'fs';
import { parseObservation, isStale, obsText } from './parse-observation.mjs';

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

export function loadBrain(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(l => l.trim());
  const entities = [];
  const relations = [];
  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      // Soft-archived entities (e.g. consolidate merged-into duplicates) are
      // skipped from health checks — they're audit-trail records, not active
      // graph nodes. Without this filter, dedup'd duplicates keep showing
      // up in the Duplicates / Orphans warnings indefinitely.
      if (data.type === 'entity' && !data._archived) entities.push(data);
      if (data.type === 'relation' && !data._archived) relations.push(data);
    } catch { /* skip malformed lines */ }
  }
  return { entities, relations };
}

export function checkStale(entities) {
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
  return { name: 'Stale Entries', passed: staleCount / dated < 0.05, violationCount: staleCount, totalCount: dated, weight: 0.20, items: staleItems };
}

export function checkDuplicates(entities) {
  const seen = new Map();
  const dupes = [];
  for (const e of entities) {
    const key = e.name.toLowerCase();
    if (seen.has(key)) dupes.push({ name: e.name, existingName: seen.get(key) });
    else seen.set(key, e.name);
  }
  return { name: 'Duplicates', passed: dupes.length === 0, violationCount: dupes.length, totalCount: entities.length, weight: 0.25, items: dupes };
}

export function checkOrphans(entities, relations) {
  const linked = new Set();
  for (const r of relations) { linked.add(r.from); linked.add(r.to); }
  const orphans = entities.filter(e => !linked.has(e.name));
  return {
    name: 'Orphan Nodes',
    passed: entities.length === 0 || orphans.length / entities.length < 0.1,
    violationCount: orphans.length, totalCount: entities.length, weight: 0.20,
    items: orphans.map(e => ({ name: e.name })),
  };
}

export function checkLowConfidence(entities) {
  let total = 0, lowCount = 0;
  const lowItems = [];
  let hasConfidence = false;
  for (const e of entities) {
    for (const obs of e.observations || []) {
      const parsed = parseObservation(obs);
      if (obsText(obs).startsWith('[')) hasConfidence = true;
      total++;
      if (parsed.confidence < 0.3) {
        lowCount++;
        lowItems.push({ entity: e.name, confidence: parsed.confidence, text: parsed.text.slice(0, 60) });
      }
    }
  }
  if (!hasConfidence) return { name: 'Low Confidence', skipped: true, reason: 'No confidence data', weight: 0.20 };
  return { name: 'Low Confidence', passed: total === 0 || lowCount / total < 0.15, violationCount: lowCount, totalCount: total, weight: 0.20, items: lowItems };
}

export function checkMissingRelations(entities, relations) {
  function extractTokens(entity) {
    const parts = [entity.name, ...(entity.observations || []).map(o => obsText(o))].join(' ');
    return [...new Set(
      parts.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    )];
  }
  const relationSet = new Set();
  for (const r of relations) { relationSet.add(`${r.from}|||${r.to}`); relationSet.add(`${r.to}|||${r.from}`); }

  let missing = 0, checked = 0;
  const missingItems = [];
  const cap = Math.min(entities.length, 500);
  for (let i = 0; i < cap; i++) {
    const tokensI = extractTokens(entities[i]);
    for (let j = i + 1; j < cap; j++) {
      const tokensJ = extractTokens(entities[j]);
      const tokenSetJ = new Set(tokensJ);
      const shared = tokensI.filter(t => tokenSetJ.has(t));
      if (shared.length >= 2) {
        checked++;
        const key = `${entities[i].name}|||${entities[j].name}`;
        if (!relationSet.has(key)) {
          missing++;
          if (missingItems.length < 10) missingItems.push({ from: entities[i].name, to: entities[j].name, shared: shared.slice(0, 3) });
        }
      }
    }
  }
  return { name: 'Missing Relations', passed: checked === 0 || (1 - missing / checked) > 0.8, violationCount: missing, totalCount: checked, weight: 0.15, items: missingItems };
}

export function calculateHealth(checks) {
  let penalty = 0;
  for (const check of checks) {
    if (check.skipped || check.passed) continue;
    const ratio = check.totalCount > 0 ? check.violationCount / check.totalCount : 0;
    penalty += check.weight * Math.min(ratio * 2, 1);
  }
  return Math.round((1 - penalty) * 100);
}
