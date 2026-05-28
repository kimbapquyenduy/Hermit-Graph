/**
 * Phase 03 — framework-strategy registry stub.
 *
 * Plugs into the cascade orchestrator as the highest-priority resolver.
 * Phase 04 will register concrete resolvers (Express, Laravel, NestJS, React,
 * Vue, Django, Rails). Until then the registry is empty and this strategy
 * always returns null, letting the cascade fall through to import / name.
 *
 * Each framework resolver implements:
 *   {
 *     name: 'express',
 *     detect: async (projectRoot) => boolean,
 *     resolve: (ref, ctx) => ResolvedReference | null,
 *   }
 *
 * Detect is run once per project at index time; `ctx.frameworks` carries
 * the set of detected names for runtime gating.
 */

const _frameworks = new Map();

/**
 * Register a framework resolver. Called by Phase 04 framework modules.
 * @param {object} resolver
 */
export function registerFramework(resolver) {
  if (!resolver?.name) throw new Error('framework resolver requires name');
  _frameworks.set(resolver.name, resolver);
}

/**
 * List registered framework names (for debugging / introspection).
 */
export function listFrameworks() {
  return [...(_frameworks.keys())];
}

/**
 * Reset registry (test helper).
 */
export function clearFrameworks() {
  _frameworks.clear();
}

/**
 * Framework resolution strategy.
 * Walks active frameworks in registration order, returns the first hit
 * with confidence >= 0.9 (high-trust framework match wins outright).
 * @param {object} ref — UnresolvedReference
 * @param {object} ctx — { graph, knownNames, projectRoot, activeFrameworks }
 * @returns {object|null}
 */
export function resolveByFramework(ref, ctx) {
  const active = ctx.activeFrameworks instanceof Set
    ? ctx.activeFrameworks
    : new Set(ctx.activeFrameworks || []);
  for (const [name, fw] of _frameworks) {
    if (active.size && !active.has(name)) continue;
    let result;
    try {
      result = fw.resolve(ref, ctx);
    } catch {
      result = null; // resolver crash never blocks cascade
    }
    if (result && result.confidence >= 0.9) {
      return { ...result, resolvedBy: `framework:${name}` };
    }
  }
  return null;
}

export const frameworkStrategy = {
  name: 'framework',
  resolve: resolveByFramework,
};
