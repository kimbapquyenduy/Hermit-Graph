/**
 * Phase 04 wave 2 — Django/Flask framework resolver.
 *
 * Patterns:
 *   path('url/', view)              — Django URL conf (positional view)
 *   re_path(r'^url/$', view)        — Django regex routes
 *   @app.route('/path')             — Flask route decorator
 *   class FooView(View):            — Django CBV (marker — no resolution target)
 *
 * Detection: requirements.txt / pyproject.toml mentions django or flask.
 */

import { pickBest } from '../scoring.mjs';

const DJANGO_PATH_RE  = /\b(?:path|re_path)\s*\(\s*[r]?['"][^'"]+['"]\s*,\s*([A-Za-z_][\w.]*)\b/;
const FLASK_ROUTE_RE  = /@(?:app|bp|blueprint)\.route\s*\(\s*['"][^'"]+['"]/;

async function readAny(fs, paths) {
  for (const p of paths) {
    try { return await fs.readFile(p, 'utf-8'); } catch {}
  }
  return null;
}

export const djangoResolver = {
  name: 'django',

  detect: async (projectRoot, fs) => {
    if (!projectRoot || !fs) return false;
    const reqs = await readAny(fs, [
      `${projectRoot}/requirements.txt`,
      `${projectRoot}/pyproject.toml`,
      `${projectRoot}/Pipfile`,
    ]);
    if (!reqs) return false;
    return /\b(django|flask|fastapi)\b/i.test(reqs);
  },

  /**
   * Live-pipeline scan for Django/Flask URL routing.
   * @returns {object[]}
   */
  scanSource(src, file, graph) {
    const rels = [];
    const seen = new Set();
    const pathGlobal       = /\b(?:path|re_path)\s*\(\s*[r]?['"][^'"]+['"]\s*,\s*([A-Za-z_][\w.]*)\b/g;
    // Flask route decorator: @app.route('/path') applied to a function
    // defined directly below. We capture the function name on the next
    // non-blank, non-decorator line.
    const flaskRouteGlobal = /@(?:app|bp|blueprint)\.route\s*\([^)]*\)[^\n]*\n(?:[^\n]*\n)?\s*def\s+([a-zA-Z_]\w*)/g;
    // CBV in Django: class FooView(View): ... — we record the class symbol.
    const cbvGlobal = /\bclass\s+([A-Z]\w*View)\s*\(/g;
    // FastAPI: @app.get('/path') / @router.post(...)
    const fastapiGlobal = /@(?:app|router)\.(?:get|post|put|patch|delete|options|head)\s*\([^)]*\)[^\n]*\n(?:[^\n]*\n)?\s*(?:async\s+)?def\s+([a-zA-Z_]\w*)/g;

    let m;
    while ((m = pathGlobal.exec(src)) !== null) {
      let viewRef = m[1];
      if (viewRef.includes('.')) viewRef = viewRef.split('.').pop();
      const line = src.slice(0, m.index).split('\n').length;
      const key = `${viewRef}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.findByName(viewRef)) {
        if (s.kind === 'function' || s.kind === 'class' || s.kind === 'method') { target = s; break; }
      }
      if (!target) continue;
      rels.push({
        _v: 1, _type: 'relation', from: file, to: target.id, kind: 'CALLS', line,
        _meta: { confidence: 0.88, resolvedBy: 'framework:django' },
      });
    }

    // Flask @app.route('/path')\ndef handler() → resolve handler.
    while ((m = flaskRouteGlobal.exec(src)) !== null) {
      const fnName = m[1];
      const line = src.slice(0, m.index).split('\n').length;
      const key = `flask:${fnName}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.findByName(fnName)) {
        if (s.kind === 'function' && s.file === file) { target = s; break; }
      }
      if (!target) continue;
      rels.push({
        _v: 1, _type: 'relation', from: file, to: target.id, kind: 'CALLS', line,
        _meta: { confidence: 0.9, resolvedBy: 'framework:django' },
      });
    }

    // FastAPI @app.get('/path')\nasync def handler() → resolve handler.
    while ((m = fastapiGlobal.exec(src)) !== null) {
      const fnName = m[1];
      const line = src.slice(0, m.index).split('\n').length;
      const key = `fastapi:${fnName}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.findByName(fnName)) {
        if (s.kind === 'function' && s.file === file) { target = s; break; }
      }
      if (!target) continue;
      rels.push({
        _v: 1, _type: 'relation', from: file, to: target.id, kind: 'CALLS', line,
        _meta: { confidence: 0.9, resolvedBy: 'framework:django' },
      });
    }

    // Django class-based view: class FooView(View) — record the class.
    while ((m = cbvGlobal.exec(src)) !== null) {
      const className = m[1];
      const line = src.slice(0, m.index).split('\n').length;
      const key = `cbv:${className}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.findByName(className)) {
        if (s.kind === 'class' && s.file === file) { target = s; break; }
      }
      if (!target) continue;
      // CBV is a marker, not a usage edge — record as low-confidence
      // self-reference so the symbol shows up in graph traversal.
      // Actually skip emitting (would be a self-edge); just dedupe.
    }
    return rels;
  },

  resolve(ref, ctx) {
    if (!ref.contextText) return null;
    const txt = ref.contextText;

    // path('url/', view) → resolve the view identifier.
    const m = DJANGO_PATH_RE.exec(txt);
    if (m) {
      let viewRef = m[1];
      // Strip module prefix (e.g. views.user_detail → user_detail).
      if (viewRef.includes('.')) viewRef = viewRef.split('.').pop();
      const candidates = [];
      for (const s of ctx.graph.symbols.values()) {
        if (s.name === viewRef && (s.kind === 'function' || s.kind === 'class' || s.kind === 'method')) {
          candidates.push(s);
        }
      }
      if (candidates.length) {
        const { candidate } = pickBest(ref, candidates);
        if (candidate) return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'calls', confidence: 0.88 };
      }
      return null;
    }

    // Flask @app.route decorator — marker only (no target to resolve here).
    if (FLASK_ROUTE_RE.test(txt)) return null;

    return null;
  },
};
