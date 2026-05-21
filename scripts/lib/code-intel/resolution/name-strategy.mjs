/**
 * Phase 03 — name-based resolution strategy.
 *
 * Default fallback when framework and import strategies don't fire. Finds
 * candidates by exact name (or ClassName.methodName), scores them via the
 * scoring ladder, returns highest-confidence match with ambiguity reporting.
 *
 * Mirrors the existing inline behavior in extractor-js relation building,
 * but adds confidence + provenance + alternative tracking.
 */

import { pickBest } from './scoring.mjs';

/**
 * Find candidates for a reference name within a graph.
 * @param {import('../graph.mjs').CodeGraph} graph
 * @param {string} name
 * @returns {object[]}
 */
function findCandidates(graph, name) {
  if (!name) return [];
  const out = [];

  // ClassName.methodName form — filter by parent.
  if (name.includes('.') && !name.includes('/')) {
    const [parent, method] = name.split('.');
    for (const s of graph.symbols.values()) {
      if (s.name === method && s.parent === parent) out.push(s);
    }
    if (out.length) return out;
  }

  // Exact name match.
  for (const s of graph.symbols.values()) {
    if (s.name === name) out.push(s);
  }
  return out;
}

/**
 * Name-resolution strategy.
 * @param {object} ref — UnresolvedReference
 * @param {object} ctx — { graph, knownNames }
 * @returns {object|null} ResolvedReference or null
 */
export function resolveByName(ref, ctx) {
  const candidates = findCandidates(ctx.graph, ref.referenceName);
  if (!candidates.length) return null;

  const { candidate, confidence, ambiguous, alternatives } = pickBest(ref, candidates);
  if (!candidate) return null;

  return {
    sourceId: ref.sourceId,
    targetId: candidate.id,
    kind: ref.referenceKind,
    confidence,
    resolvedBy: ambiguous ? 'name:fuzzy' : 'name',
    alternatives: ambiguous ? alternatives.map(c => c.id) : undefined,
  };
}

export const nameStrategy = {
  name: 'name',
  resolve: resolveByName,
};
