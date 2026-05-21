/**
 * Phase 04 — Express.js framework resolver.
 *
 * Recognizes route registrations and resolves the handler identifier:
 *   app.get('/users/:id', getUser)        → calls → getUser
 *   router.post('/checkout', checkoutHandler) → calls → checkoutHandler
 *
 * Pattern is applied to the source text supplied via ref.contextText (a
 * window of source around the reference). For now we expect callers to
 * pass that — Phase 03 wave 2 will arrange for extractors to capture it.
 *
 * Confidence: 0.85 on identifier match (below 0.9 because string-based
 * dispatch can have typos; the cascade may still prefer name strategy if
 * the resolved candidate scores higher).
 */

import { pickBest } from '../scoring.mjs';

const EXPRESS_ROUTE_RE = /\b(app|router)\.(get|post|put|patch|delete|all|use)\s*\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/;

export const expressResolver = {
  name: 'express',

  // Run at project boot; result cached in ctx.activeFrameworks.
  detect: async (projectRoot, fs) => {
    if (!projectRoot || !fs) return false;
    try {
      const pkgPath = `${projectRoot}/package.json`;
      const raw = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      return Object.prototype.hasOwnProperty.call(deps, 'express');
    } catch {
      return false;
    }
  },

  /**
   * Resolve a reference using Express patterns.
   * Returns null when ref doesn't match — caller's cascade then falls through.
   *
   * Requires ref.contextText (source window). Without it, returns null.
   *
   * @param {object} ref — UnresolvedReference (must include contextText)
   * @param {object} ctx — { graph }
   */
  /**
   * Live-pipeline scan for Express route registrations.
   * @param {string} src
   * @param {string} file
   * @param {import('../../graph.mjs').CodeGraph} graph
   * @returns {object[]}
   */
  scanSource(src, file, graph) {
    const rels = [];
    const seen = new Set();
    const routeGlobal = /\b(app|router)\.(get|post|put|patch|delete|all|use)\s*\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;

    const fileSymbols = [];
    for (const s of graph.symbols.values()) {
      if (s.file === file && (s.kind === 'function' || s.kind === 'method')) fileSymbols.push(s);
    }
    fileSymbols.sort((a, b) => (a.line?.[0] || 0) - (b.line?.[0] || 0));
    const enclosingId = (line) => {
      let c = null;
      for (const s of fileSymbols) {
        const a = s.line?.[0] ?? 0, b = s.line?.[1] ?? a;
        if (a <= line && b >= line && (!c || (b - a) < (c.line[1] - c.line[0]))) c = s;
      }
      return c?.id || file;
    };

    let m;
    while ((m = routeGlobal.exec(src)) !== null) {
      const handlerName = m[4];
      const line = src.slice(0, m.index).split('\n').length;
      const key = `${handlerName}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.symbols.values()) {
        if (s.name === handlerName && (s.kind === 'function' || s.kind === 'method')) { target = s; break; }
      }
      if (!target) continue;
      const fromId = enclosingId(line);
      if (fromId === target.id) continue;
      rels.push({
        _v: 1, _type: 'relation', from: fromId, to: target.id, kind: 'CALLS', line,
        _meta: { confidence: 0.85, resolvedBy: 'framework:express' },
      });
    }
    return rels;
  },

  resolve(ref, ctx) {
    if (!ref.contextText || ref.referenceKind !== 'calls') return null;
    const m = EXPRESS_ROUTE_RE.exec(ref.contextText);
    if (!m) return null;
    const handlerName = m[4];
    // Look up handler in graph.
    const candidates = [];
    for (const s of ctx.graph.symbols.values()) {
      if (s.name === handlerName) candidates.push(s);
    }
    if (!candidates.length) return null;
    const { candidate } = pickBest(ref, candidates);
    if (!candidate) return null;
    return {
      sourceId: ref.sourceId,
      targetId: candidate.id,
      kind: 'calls',
      confidence: 0.85,
      // resolvedBy is overwritten to 'framework:express' by the cascade.
    };
  },
};
