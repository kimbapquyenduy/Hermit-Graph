/**
 * Brain Health Check functions — pure logic, no CLI side effects.
 * Extracted from brain-health.mjs for reuse in MCP tools.
 */

import { readFileSync } from 'fs';
import { parseObservation, isStale, obsText } from './parse-observation.mjs';
import {
  ENTITY_TYPES, NAME_PREFIXES, MIN_OBSERVATIONS, REQUIRED_OBS_KEYS,
  RELATION_TYPES, namePrefix, observationKey,
} from './brain-schema-registry.mjs';

/**
 * Observations inside an ACTIVE entity can themselves be archived (superseded by
 * a contradicting observation). They are audit-trail records, not live
 * knowledge, so counting them inflates every observation-based denominator.
 * @param {object} entity
 * @returns {Array}
 */
export function activeObservations(entity) {
  return (entity.observations || []).filter(o => !(typeof o === 'object' && o !== null && o._archived));
}

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
  // Archived entity names are tracked (not just dropped) so dangling-relation
  // reporting can say "points at an archived entity" instead of "doesn't exist".
  const archivedNames = new Set();
  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      // Soft-archived entities (e.g. consolidate merged-into duplicates) are
      // skipped from health checks — they're audit-trail records, not active
      // graph nodes. Without this filter, dedup'd duplicates keep showing
      // up in the Duplicates / Orphans warnings indefinitely.
      if (data.type === 'entity') {
        if (data._archived) archivedNames.add(data.name);
        else entities.push(data);
      }
      if (data.type === 'relation' && !data._archived) relations.push(data);
    } catch { /* skip malformed lines */ }
  }
  return { entities, relations, archivedNames };
}

export function checkStale(entities) {
  let dated = 0, staleCount = 0;
  const staleItems = [];
  for (const e of entities) {
    for (const obs of activeObservations(e)) {
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
    for (const obs of activeObservations(e)) {
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

// ── Missing Relations (relation suggestions) ──
//
// The previous heuristic flagged any entity pair sharing >=2 non-stopword
// tokens. On a real graph that meant 105.161 of 105.746 pairs (99,4%) — pairs
// matched on the entityType word ("biz") and the observation date ("2026"), so
// the check both always failed AND told the user to create 105k relations.
// It also re-tokenized the inner entity on every pair (250k tokenizations,
// ~4,3s of the health run).
//
// Now: tokens are indexed once, generic tokens are dropped by document
// frequency, and a pair is only a candidate when it shares RARE tokens AND is
// plausibly linkable (same project scope + an allowed entity-type pairing).
// Reported as informational (weight 0) until the precision is validated.

/** A token appearing in more than this share of entities carries no signal. */
const GENERIC_TOKEN_RATIO = 0.05;

/** A shared token is only interesting if at most this many entities have it. */
const RARE_TOKEN_MAX_DF = 5;

/** Minimum confidence for a suggestion to be reported. */
const MIN_SUGGESTION_CONFIDENCE = 0.3;

/** Maximum suggestions reported — never dump thousands at the user. */
const MAX_SUGGESTIONS = 10;

/** Segments that are tier modifiers, not project scopes. */
const TIER_MODIFIERS = new Set([
  'arch', 'code', 'int', 'integration', 'decision', 'person', 'config',
  'stack', 'biz', 'tech', 'rule', 'flow', 'entity', 'incident', 'gotcha',
]);

/**
 * Entity-type pairs where a relation is semantically plausible. Prevents
 * suggestions like "BIZ:ProjectAlpha ↔ TECH:Person:MentorX".
 * Keys are the two types sorted and joined with '|'.
 */
const PLAUSIBLE_TYPE_PAIRS = new Set([
  'biz-domain|biz-rule', 'biz-domain|biz-flow', 'biz-domain|biz-entity',
  'biz-flow|biz-rule', 'biz-entity|biz-rule', 'biz-entity|biz-flow',
  'biz-flow|incident-bug', 'biz-entity|incident-bug', 'biz-rule|incident-bug',
  'biz-flow|incident-gotcha', 'biz-entity|incident-gotcha',
  'incident-bug|pattern-code', 'incident-bug|tech-stack',
  'incident-gotcha|pattern-code', 'incident-gotcha|tech-stack',
  'pattern-arch|pattern-code', 'pattern-code|tech-stack',
  'pattern-arch|tech-stack', 'pattern-arch|pattern-integration',
  'pattern-integration|tech-stack',
  'tech-decision|tech-stack', 'pattern-arch|tech-decision',
  'tech-config|tech-stack',
  'biz-domain|tech-stack', 'biz-domain|pattern-arch',
]);

/**
 * Project scope embedded in a TIER:SCOPE:LABEL name — the first segment after
 * the tier that isn't a tier modifier. Two entities of the same project are far
 * more likely to warrant a relation than two entities from unrelated projects.
 * @param {string} name
 * @returns {string|null}
 */
function entityScopeKey(name) {
  const parts = String(name).split(':').map(p => p.trim()).filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i].toLowerCase().replace(/[\s\-_]/g, '');
    if (!TIER_MODIFIERS.has(p)) return p;
  }
  return null;
}

/**
 * Tokenize every entity ONCE and record how many entities each token appears
 * in, so generic tokens can be dropped without re-scanning per pair.
 * @param {Array} entities
 * @returns {{ tokenSets: Array<Set<string>>, docFreq: Map<string, number> }}
 */
function buildTokenIndex(entities) {
  const tokenSets = [];
  const docFreq = new Map();
  for (const e of entities) {
    const text = [e.name, ...(e.observations || []).map(o => obsText(o))].join(' ');
    const tokens = new Set(
      text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    );
    tokenSets.push(tokens);
    for (const t of tokens) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }
  return { tokenSets, docFreq };
}

export function checkMissingRelations(entities, relations) {
  const relationSet = new Set();
  for (const r of relations) {
    relationSet.add(`${r.from}|||${r.to}`);
    relationSet.add(`${r.to}|||${r.from}`);
  }

  const { tokenSets, docFreq } = buildTokenIndex(entities);
  const genericCutoff = Math.max(2, Math.floor(entities.length * GENERIC_TOKEN_RATIO));

  // Keep only the rare, discriminating tokens per entity.
  const rareSets = tokenSets.map(set => {
    const out = new Set();
    for (const t of set) {
      const df = docFreq.get(t);
      if (df >= 2 && df <= RARE_TOKEN_MAX_DF && df <= genericCutoff) out.add(t);
    }
    return out;
  });

  const scopes = entities.map(e => entityScopeKey(e.name));

  let missing = 0, checked = 0;
  const suggestions = [];
  for (let i = 0; i < entities.length; i++) {
    if (rareSets[i].size < 2) continue;
    for (let j = i + 1; j < entities.length; j++) {
      if (rareSets[j].size < 2) continue;

      // Gate 1 — same project scope.
      if (!scopes[i] || scopes[i] !== scopes[j]) continue;

      // Gate 2 — the two entity types can plausibly be related.
      const pairKey = [entities[i].entityType, entities[j].entityType].sort().join('|');
      if (!PLAUSIBLE_TYPE_PAIRS.has(pairKey)) continue;

      // Gate 3 — they share at least two rare tokens.
      const shared = [];
      let confidence = 0;
      for (const t of rareSets[i]) {
        if (!rareSets[j].has(t)) continue;
        shared.push(t);
        confidence += 1 / docFreq.get(t);
      }
      if (shared.length < 2) continue;

      checked++;
      if (relationSet.has(`${entities[i].name}|||${entities[j].name}`)) continue;
      missing++;
      confidence = Math.min(1, confidence);
      if (confidence >= MIN_SUGGESTION_CONFIDENCE) {
        suggestions.push({
          from: entities[i].name,
          to: entities[j].name,
          shared: shared.slice(0, 3),
          confidence: Number(confidence.toFixed(2)),
        });
      }
    }
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);
  return {
    name: 'Missing Relations',
    // Informational only: weight 0 keeps an unproven heuristic out of the score.
    passed: true,
    informational: true,
    violationCount: missing,
    totalCount: checked,
    weight: 0,
    items: suggestions.slice(0, MAX_SUGGESTIONS),
  };
}

/**
 * Schema Conformance — entityType validity, TIER prefix, minimum observation
 * count, and required observation keys, all per brain-schema-registry.
 * REPORT ONLY: the server accepts free-form types, so this surfaces drift
 * rather than blocking writes.
 * @param {Array} entities
 * @returns {object} check result
 */
export function checkSchemaConformance(entities) {
  const items = [];
  for (const e of entities) {
    const problems = [];
    const type = e.entityType;

    if (!ENTITY_TYPES.has(type)) {
      problems.push(`unknown entityType "${type}"`);
    } else {
      const allowed = NAME_PREFIXES[type] || [];
      const prefix = namePrefix(e.name);
      if (allowed.length && !allowed.includes(prefix)) {
        problems.push(`name prefix "${prefix}" not one of ${allowed.join('/')}`);
      }

      const obs = activeObservations(e);
      const min = MIN_OBSERVATIONS[type];
      if (min && obs.length < min) problems.push(`${obs.length}/${min} observations`);

      const present = new Set();
      for (const o of obs) {
        const key = observationKey(obsText(o));
        if (key) present.add(key);
      }
      const missingKeys = (REQUIRED_OBS_KEYS[type] || []).filter(k => !present.has(k));
      if (missingKeys.length) problems.push(`missing keys: ${missingKeys.join(', ')}`);
    }

    if (problems.length) items.push({ name: e.name, entityType: type, problems });
  }

  return {
    name: 'Schema Conformance',
    passed: entities.length === 0 || items.length / entities.length < 0.2,
    violationCount: items.length,
    totalCount: entities.length,
    weight: 0.10,
    items,
  };
}

/**
 * Dangling Relations — endpoints that don't exist, or that point at archived
 * entities. Unlike the schema drift above this is unambiguous corruption, so it
 * counts toward the score immediately.
 * @param {Array} entities - ACTIVE entities (loadBrain already filters archived)
 * @param {Array} relations
 * @param {Set<string>} [archivedNames] - names of archived entities, if known
 * @returns {object} check result
 */
export function checkDanglingRelations(entities, relations, archivedNames = new Set()) {
  const active = new Set(entities.map(e => e.name));
  const items = [];
  for (const r of relations) {
    const reasons = [];
    for (const [side, name] of [['from', r.from], ['to', r.to]]) {
      if (active.has(name)) continue;
      reasons.push(archivedNames.has(name) ? `${side} is archived` : `${side} does not exist`);
    }
    if (reasons.length) {
      items.push({ from: r.from, to: r.to, relationType: r.relationType, reasons });
    }
  }
  return {
    name: 'Dangling Relations',
    passed: items.length === 0,
    violationCount: items.length,
    totalCount: relations.length,
    weight: 0.15,
    items,
  };
}

/**
 * Relation Vocabulary — relationTypes outside the canonical registry.
 * Informational: the long tail looks deliberate in places, and deleting
 * relations is never the right automatic response.
 * @param {Array} relations
 * @returns {object} check result
 */
export function checkRelationVocabulary(relations) {
  const offenders = new Map();
  for (const r of relations) {
    if (RELATION_TYPES.has(r.relationType)) continue;
    offenders.set(r.relationType, (offenders.get(r.relationType) || 0) + 1);
  }
  let violationCount = 0;
  for (const n of offenders.values()) violationCount += n;
  const items = [...offenders.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([relationType, count]) => ({ relationType, count }));
  return {
    name: 'Relation Vocabulary',
    passed: true,
    informational: true,
    violationCount,
    totalCount: relations.length,
    weight: 0,
    items: items.slice(0, 10),
    distinctOffenders: items.length,
  };
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
