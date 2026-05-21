/**
 * Phase 04 wave 2 — Vue framework resolver.
 *
 * Patterns:
 *   <component-name />              — template element (kebab-case)
 *   <ComponentName />               — template element (PascalCase)
 *   defineComponent({ ... })         — component definition (marker)
 *   useXxx(...)                      — composable call
 *
 * Detection: package.json dep on vue.
 */

import { pickBest } from '../scoring.mjs';

const VUE_TAG_RE = /<([A-Z][A-Za-z0-9_]*|[a-z]+(?:-[a-z]+)+)\b/;
const COMPOSABLE_RE = /\b(use[A-Z][A-Za-z0-9_]*)\s*\(/;

function kebabToPascal(name) {
  return name.split('-').map(p => p[0]?.toUpperCase() + p.slice(1)).join('');
}

export const vueResolver = {
  name: 'vue',

  detect: async (projectRoot, fs) => {
    if (!projectRoot || !fs) return false;
    try {
      const pkg = JSON.parse(await fs.readFile(`${projectRoot}/package.json`, 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      return Object.prototype.hasOwnProperty.call(deps, 'vue');
    } catch {
      return false;
    }
  },

  /**
   * Live-pipeline scan: regex-scan source globally, emit RENDERS/CALLS
   * relations for Vue components + composables.
   *
   * @param {string} src
   * @param {string} file
   * @param {import('../../graph.mjs').CodeGraph} graph
   * @returns {object[]}
   */
  scanSource(src, file, graph) {
    const rels = [];
    const seen = new Set();
    const tagGlobal = /<([A-Z][A-Za-z0-9_]*|[a-z]+(?:-[a-z]+)+)\b/g;
    const compGlobal = /\b(use[A-Z][A-Za-z0-9_]*)\s*\(/g;

    const fileSymbols = [];
    for (const s of graph.symbols.values()) {
      if (s.file === file && (s.kind === 'function' || s.kind === 'method' || s.kind === 'component')) {
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

    let match;
    while ((match = tagGlobal.exec(src)) !== null) {
      const raw = match[1];
      // Skip native HTML tags — Vue tags are PascalCase or contain a hyphen.
      if (!/[A-Z]|-/.test(raw)) continue;
      const pascal = raw.includes('-') ? raw.split('-').map(p => p[0]?.toUpperCase() + p.slice(1)).join('') : raw;
      const line = src.slice(0, match.index).split('\n').length;
      const key = `${pascal}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.symbols.values()) {
        if ((s.name === pascal || s.name === raw) && (s.kind === 'component' || s.kind === 'function')) {
          target = s; break;
        }
      }
      if (!target) continue;
      const fromId = enclosingId(line);
      if (fromId === target.id) continue;
      rels.push({
        _v: 1, _type: 'relation', from: fromId, to: target.id, kind: 'RENDERS', line,
        _meta: { confidence: 0.9, resolvedBy: 'framework:vue' },
      });
    }

    while ((match = compGlobal.exec(src)) !== null) {
      const name = match[1];
      const line = src.slice(0, match.index).split('\n').length;
      const key = `composable:${name}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.symbols.values()) {
        if (s.name === name && (s.kind === 'function' || s.kind === 'method')) { target = s; break; }
      }
      if (!target) continue;
      const fromId = enclosingId(line);
      if (fromId === target.id) continue;
      rels.push({
        _v: 1, _type: 'relation', from: fromId, to: target.id, kind: 'CALLS', line,
        _meta: { confidence: 0.85, resolvedBy: 'framework:vue' },
      });
    }
    return rels;
  },

  resolve(ref, ctx) {
    if (!ref.contextText) return null;
    const txt = ref.contextText;

    // Vue template component reference (PascalCase or kebab-case).
    let m = VUE_TAG_RE.exec(txt);
    if (m) {
      const raw = m[1];
      const pascal = raw.includes('-') ? kebabToPascal(raw) : raw;
      // Vue HTML tags (e.g. div, span) won't match — regex requires PascalCase or hyphen.
      const candidates = [];
      for (const s of ctx.graph.symbols.values()) {
        if ((s.name === pascal || s.name === raw) && (s.kind === 'component' || s.kind === 'function')) {
          candidates.push(s);
        }
      }
      if (candidates.length) {
        const { candidate } = pickBest(ref, candidates);
        if (candidate) return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'renders', confidence: 0.9 };
      }
      return null;
    }

    // Composables (useFoo, useBar).
    m = COMPOSABLE_RE.exec(txt);
    if (m) {
      const composableName = m[1];
      const candidates = [];
      for (const s of ctx.graph.symbols.values()) {
        if (s.name === composableName && (s.kind === 'function' || s.kind === 'method')) candidates.push(s);
      }
      if (candidates.length) {
        const { candidate } = pickBest(ref, candidates);
        if (candidate) return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'calls', confidence: 0.85 };
      }
      return null;
    }

    return null;
  },
};
