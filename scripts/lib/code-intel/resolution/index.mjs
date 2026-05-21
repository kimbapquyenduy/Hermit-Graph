/**
 * Phase 03 — multi-strategy resolution orchestrator.
 *
 * Cascades through strategies (framework → import → name) with early-exit
 * at confidence >= 0.9. Below threshold, collects all candidates and picks
 * the highest-confidence result. Emits ResolvedReference with provenance.
 *
 * Strategies are pluggable via registerStrategy(); built-in registration:
 *   1. frameworkStrategy  (Phase 04 frameworks)
 *   2. nameStrategy       (fallback)
 *
 * Import strategy not implemented yet — slot reserved between framework
 * and name when Phase 03 wave 2 lands. Adding it requires per-file import
 * extraction during pass-1, which is a larger lift than this scaffolding.
 */

import { buildKnownNames, isKnownName } from './known-names.mjs';
import { nameStrategy } from './name-strategy.mjs';
import { frameworkStrategy, registerFramework, listFrameworks, clearFrameworks } from './framework-strategy.mjs';

// Strategy chain — order matters. Framework runs first (highest confidence
// when it hits), name is the universal fallback.
const _strategies = [frameworkStrategy, nameStrategy];

// Re-export framework registry for Phase 04 module bootstraps.
export { registerFramework, listFrameworks, clearFrameworks };
export { nameStrategy, frameworkStrategy };
export { buildKnownNames, isKnownName };

const HIGH_CONFIDENCE = 0.9;

/**
 * Resolve a single reference through the cascade.
 * @param {object} ref — UnresolvedReference { sourceId, referenceName, referenceKind, fromFile, fromLine, fromLang }
 * @param {object} ctx — { graph, knownNames, projectRoot, activeFrameworks }
 * @returns {object|null} ResolvedReference or null when nothing resolves
 */
export function resolveReference(ref, ctx) {
  if (!ctx.knownNames || !isKnownName(ctx.knownNames, ref.referenceName)) {
    // Pre-filter: name doesn't exist in graph → no point cascading.
    return null;
  }

  const candidates = [];
  for (const strategy of _strategies) {
    let result;
    try {
      result = strategy.resolve(ref, ctx);
    } catch {
      result = null; // strategy crash never blocks the cascade
    }
    if (!result) continue;
    // Early exit on high-confidence framework match.
    if (result.confidence >= HIGH_CONFIDENCE) return result;
    candidates.push(result);
  }
  if (!candidates.length) return null;
  // Pick highest-confidence below-threshold candidate.
  return candidates.reduce((best, cur) => (cur.confidence > best.confidence ? cur : best));
}

/**
 * Resolve a batch of references against a graph. Caller owns the graph;
 * we build knownNames once and reuse across all refs in the batch.
 *
 * @param {object[]} refs
 * @param {object} ctxBase — { graph, projectRoot?, activeFrameworks? }
 * @returns {object[]} ResolvedReference[] (only successful resolutions)
 */
export function resolveBatch(refs, ctxBase) {
  const knownNames = buildKnownNames(ctxBase.graph);
  const ctx = { ...ctxBase, knownNames };
  const out = [];
  for (const ref of refs) {
    const r = resolveReference(ref, ctx);
    if (r) out.push(r);
  }
  return out;
}
