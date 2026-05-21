/**
 * Phase 04 wave 2 — React framework resolver.
 *
 * Two patterns:
 *   <ComponentName ... />          — JSX element → component definition
 *   useXxx(...)                    — hook call → hook definition or React lib
 *
 * Detection: package.json dep on react.
 */

import { pickBest } from '../scoring.mjs';

const JSX_TAG_RE  = /<([A-Z][A-Za-z0-9_]*)\b/;
const HOOK_CALL_RE = /\b(use[A-Z][A-Za-z0-9_]*)\s*\(/;

// Hooks bundled with React itself — we don't try to resolve to a project
// symbol for these; they live in react package. Return null so caller can
// add a "library:react" annotation if desired.
const REACT_BUILTIN_HOOKS = new Set([
  'useState', 'useEffect', 'useContext', 'useReducer', 'useCallback',
  'useMemo', 'useRef', 'useImperativeHandle', 'useLayoutEffect',
  'useDebugValue', 'useDeferredValue', 'useTransition', 'useId',
  'useSyncExternalStore', 'useInsertionEffect',
]);

export const reactResolver = {
  name: 'react',

  detect: async (projectRoot, fs) => {
    if (!projectRoot || !fs) return false;
    try {
      const pkg = JSON.parse(await fs.readFile(`${projectRoot}/package.json`, 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      return Object.prototype.hasOwnProperty.call(deps, 'react');
    } catch {
      return false;
    }
  },

  /**
   * Live-pipeline scan: regex-scan source globally, emit one relation per
   * resolved match. Used by indexer's runFrameworkPass.
   *
   * Skips JSX tags that don't resolve to a project symbol (library
   * components live in node_modules and aren't indexed — correct behavior).
   *
   * @param {string} src
   * @param {string} file - relative path
   * @param {import('../../graph.mjs').CodeGraph} graph
   * @returns {object[]} relation records
   */
  scanSource(src, file, graph) {
    const rels = [];
    const seen = new Set();
    const jsxGlobal = /<([A-Z][A-Za-z0-9_]*)\b/g;
    const hookGlobal = /\b(use[A-Z][A-Za-z0-9_]*)\s*\(/g;

    // Cache file's symbols sorted by line for enclosing-function lookup.
    const fileSymbols = [];
    for (const s of graph.symbols.values()) {
      if (s.file === file && (s.kind === 'function' || s.kind === 'class' || s.kind === 'method')) {
        fileSymbols.push(s);
      }
    }
    fileSymbols.sort((a, b) => (a.line?.[0] || 0) - (b.line?.[0] || 0));

    // Find smallest symbol that contains `line` — its ID becomes the relation's from.
    const enclosingId = (line) => {
      let candidate = null;
      for (const s of fileSymbols) {
        const start = s.line?.[0] ?? 0;
        const end = s.line?.[1] ?? start;
        if (start <= line && end >= line) {
          // Prefer narrowest enclosing symbol — overwrite if tighter range.
          if (!candidate || (end - start) < (candidate.line[1] - candidate.line[0])) {
            candidate = s;
          }
        }
      }
      return candidate?.id || file; // fall back to file path when no enclosing symbol
    };

    let match;
    while ((match = jsxGlobal.exec(src)) !== null) {
      const componentName = match[1];
      const line = src.slice(0, match.index).split('\n').length;
      const dedupeKey = `${componentName}@${line}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      let target = null;
      for (const s of graph.symbols.values()) {
        if (s.name === componentName && (s.kind === 'function' || s.kind === 'class' || s.kind === 'component')) {
          target = s; break;
        }
      }
      if (!target) continue;
      const fromId = enclosingId(line);
      if (fromId === target.id) continue; // self-render guard
      rels.push({
        _v: 1,
        _type: 'relation',
        from: fromId,
        to: target.id,
        kind: 'RENDERS',
        line,
        _meta: { confidence: 0.92, resolvedBy: 'framework:react' },
      });
    }

    while ((match = hookGlobal.exec(src)) !== null) {
      const hookName = match[1];
      if (REACT_BUILTIN_HOOKS.has(hookName)) continue;
      const line = src.slice(0, match.index).split('\n').length;
      const dedupeKey = `hook:${hookName}@${line}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      let target = null;
      for (const s of graph.symbols.values()) {
        if (s.name === hookName && (s.kind === 'function' || s.kind === 'method')) {
          target = s; break;
        }
      }
      if (!target) continue;
      const fromId = enclosingId(line);
      if (fromId === target.id) continue;
      rels.push({
        _v: 1,
        _type: 'relation',
        from: fromId,
        to: target.id,
        kind: 'CALLS',
        line,
        _meta: { confidence: 0.88, resolvedBy: 'framework:react' },
      });
    }

    return rels;
  },

  resolve(ref, ctx) {
    if (!ref.contextText) return null;
    const txt = ref.contextText;

    // JSX component reference.
    let m = JSX_TAG_RE.exec(txt);
    if (m) {
      const componentName = m[1];
      const candidates = [];
      for (const s of ctx.graph.symbols.values()) {
        // React components are usually PascalCase functions OR class components.
        if (s.name === componentName && (s.kind === 'function' || s.kind === 'class' || s.kind === 'component')) {
          candidates.push(s);
        }
      }
      if (candidates.length) {
        const { candidate } = pickBest(ref, candidates);
        if (candidate) return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'renders', confidence: 0.92 };
      }
      return null;
    }

    // Hook call.
    m = HOOK_CALL_RE.exec(txt);
    if (m) {
      const hookName = m[1];
      if (REACT_BUILTIN_HOOKS.has(hookName)) return null;
      const candidates = [];
      for (const s of ctx.graph.symbols.values()) {
        if (s.name === hookName && (s.kind === 'function' || s.kind === 'method')) candidates.push(s);
      }
      if (candidates.length) {
        const { candidate } = pickBest(ref, candidates);
        if (candidate) return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'calls', confidence: 0.88 };
      }
      return null;
    }

    return null;
  },
};
