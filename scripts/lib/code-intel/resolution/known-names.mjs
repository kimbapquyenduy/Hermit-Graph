/**
 * Phase 03 — knownNames Set pre-filter.
 *
 * Pre-filters references whose name has zero candidates in the graph. The
 * cascade (framework → import → name) would waste time on those; this Set
 * gives O(1) rejection.
 *
 * Populated at index time from extracted symbols.
 */

/**
 * Build a Set of all known symbol names from a graph.
 * @param {import('../graph.mjs').CodeGraph} graph
 * @returns {Set<string>}
 */
export function buildKnownNames(graph) {
  const names = new Set();
  for (const s of graph.symbols.values()) {
    if (s.name) names.add(s.name);
    // Also index qualified Class.method forms for ClassName.methodName lookups.
    if (s.parent && s.name) names.add(`${s.parent}.${s.name}`);
  }
  return names;
}

/**
 * Quick check whether a reference name is known.
 * @param {Set<string>} knownNames
 * @param {string} name
 * @returns {boolean}
 */
export function isKnownName(knownNames, name) {
  if (!name) return false;
  if (knownNames.has(name)) return true;
  // Allow loose match for Class.method when only method is known (or vice versa).
  if (name.includes('.')) {
    const [, method] = name.split('.');
    if (method && knownNames.has(method)) return true;
  }
  return false;
}
