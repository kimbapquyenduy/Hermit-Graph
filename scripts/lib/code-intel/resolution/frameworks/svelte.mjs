/**
 * Phase 04 — Svelte framework resolver.
 *
 * Patterns:
 *   <ComponentName .../>           — JSX-like template tags → RENDERS edge
 *   {fn()} mustache calls          — template function calls
 *
 * Filters Svelte 5 runes ($state/$derived/$effect/$props/etc.) — they're
 * compiler intrinsics, not user-defined functions, so we don't resolve them.
 */

import { pickBest } from '../scoring.mjs';

const SVELTE_RUNES = new Set([
  '$state', '$derived', '$effect', '$props', '$bindable',
  '$inspect', '$host',
]);

const SVELTE_TAG_RE = /<([A-Z][A-Za-z0-9_]*)\b/;
const MUSTACHE_CALL_RE = /\{[^}]*?\b([a-zA-Z_$][\w$]*)\s*\(/;

export const svelteResolver = {
  name: 'svelte',

  detect: async (projectRoot, fs) => {
    if (!projectRoot || !fs) return false;
    try {
      const pkg = JSON.parse(await fs.readFile(`${projectRoot}/package.json`, 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      return Object.prototype.hasOwnProperty.call(deps, 'svelte');
    } catch {
      return false;
    }
  },

  /**
   * Live-pipeline scan: emit RENDERS for component tags + CALLS for
   * template function calls. Skips Svelte runes.
   */
  scanSource(src, file, graph) {
    const rels = [];
    const seen = new Set();
    const tagGlobal = /<([A-Z][A-Za-z0-9_]*)\b/g;
    const mustacheGlobal = /\{[^}]*?\b([a-zA-Z_$][\w$]*)\s*\(/g;

    const fileSymbols = [];
    for (const s of graph.symbols.values()) {
      if (s.file === file && (s.kind === 'component' || s.kind === 'function' || s.kind === 'method')) {
        fileSymbols.push(s);
      }
    }
    fileSymbols.sort((a, b) => (a.line?.[0] || 0) - (b.line?.[0] || 0));

    const enclosingId = (line) => {
      let cand = null;
      for (const s of fileSymbols) {
        const a = s.line?.[0] ?? 0;
        const b = s.line?.[1] ?? a;
        if (a <= line && b >= line && (!cand || (b - a) < (cand.line[1] - cand.line[0]))) cand = s;
      }
      return cand?.id || file;
    };

    let m;
    while ((m = tagGlobal.exec(src)) !== null) {
      const tagName = m[1];
      const line = src.slice(0, m.index).split('\n').length;
      const key = `tag:${tagName}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.findByName(tagName)) {
        if (s.kind === 'component' || s.kind === 'function') { target = s; break; }
      }
      if (!target) continue;
      const fromId = enclosingId(line);
      if (fromId === target.id) continue;
      rels.push({
        _v: 1, _type: 'relation', from: fromId, to: target.id, kind: 'RENDERS', line,
        _meta: { confidence: 0.9, resolvedBy: 'framework:svelte' },
      });
    }

    while ((m = mustacheGlobal.exec(src)) !== null) {
      const fnName = m[1];
      if (SVELTE_RUNES.has(fnName)) continue;
      // Skip control-flow keywords
      if (['if', 'each', 'await', 'then', 'catch', 'snippet'].includes(fnName)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      const key = `call:${fnName}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.findByName(fnName)) {
        if (s.kind === 'function' || s.kind === 'method') { target = s; break; }
      }
      if (!target) continue;
      const fromId = enclosingId(line);
      if (fromId === target.id) continue;
      rels.push({
        _v: 1, _type: 'relation', from: fromId, to: target.id, kind: 'CALLS', line,
        _meta: { confidence: 0.85, resolvedBy: 'framework:svelte' },
      });
    }

    return rels;
  },

  /**
   * Cascade entry point. Same shape as other resolvers — relies on
   * ref.contextText containing the relevant source window.
   */
  resolve(ref, ctx) {
    if (!ref.contextText) return null;
    const txt = ref.contextText;

    let m = SVELTE_TAG_RE.exec(txt);
    if (m) {
      const componentName = m[1];
      const candidates = [];
      for (const s of ctx.graph.symbols.values()) {
        if (s.name === componentName && (s.kind === 'component' || s.kind === 'function')) {
          candidates.push(s);
        }
      }
      if (!candidates.length) return null;
      const { candidate } = pickBest(ref, candidates);
      if (!candidate) return null;
      return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'renders', confidence: 0.9 };
    }

    m = MUSTACHE_CALL_RE.exec(txt);
    if (m) {
      const fnName = m[1];
      if (SVELTE_RUNES.has(fnName)) return null;
      const candidates = [];
      for (const s of ctx.graph.symbols.values()) {
        if (s.name === fnName && (s.kind === 'function' || s.kind === 'method')) {
          candidates.push(s);
        }
      }
      if (!candidates.length) return null;
      const { candidate } = pickBest(ref, candidates);
      if (!candidate) return null;
      return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'calls', confidence: 0.85 };
    }

    return null;
  },
};
