/**
 * Phase 04 wave 2 — Laravel framework resolver.
 *
 * Five high-value patterns:
 *   Model::find(...)               → app/Models/Model.php
 *   Facade::method()               → vendor/.../Facades/Facade.php (external)
 *   route('name.path')             → routes/*.php with ->name('name.path')
 *   view('blade.path')             → resources/views/blade/path.blade.php
 *   [Controller::class, 'method']  → app/Http/Controllers/Controller.php
 *
 * Confidence 0.85 on AST-resolvable patterns. Facade hits return 0.7
 * because the symbol is in vendor/ — agent should know it's external.
 */

import { pickBest } from '../scoring.mjs';

const MODEL_STATIC_RE  = /\b([A-Z][a-zA-Z]+)::(\w+)\s*\(/;
const FACADE_RE        = /\b(Auth|Cache|DB|Log|Mail|Queue|Session|Storage|Validator|Hash|Crypt|Config|Route|Schema|Artisan|Bus|Event|Notification)::(\w+)\s*\(/;
const ROUTE_HELPER_RE  = /\broute\s*\(\s*['"]([\w.-]+)['"]/;
const VIEW_HELPER_RE   = /\bview\s*\(\s*['"]([\w.-]+)['"]/;
const CONTROLLER_TUPLE_RE = /\[\s*([A-Z][a-zA-Z]+Controller)\s*::\s*class\s*,\s*['"](\w+)['"]\s*\]/;

const FACADE_NAMES = new Set([
  'Auth','Cache','DB','Log','Mail','Queue','Session','Storage','Validator',
  'Hash','Crypt','Config','Route','Schema','Artisan','Bus','Event','Notification',
]);

function lookup(graph, name) {
  const out = [];
  for (const s of graph.symbols.values()) {
    if (s.name === name) out.push(s);
  }
  return out;
}

function lookupByParent(graph, parent, name) {
  const out = [];
  for (const s of graph.symbols.values()) {
    if (s.name === name && s.parent === parent) out.push(s);
  }
  return out;
}

export const laravelResolver = {
  name: 'laravel',

  detect: async (projectRoot, fs) => {
    if (!projectRoot || !fs) return false;
    try {
      // Laravel signal: composer.json with laravel/framework + artisan file.
      const composer = JSON.parse(await fs.readFile(`${projectRoot}/composer.json`, 'utf-8'));
      const deps = { ...(composer.require || {}), ...(composer['require-dev'] || {}) };
      return Object.prototype.hasOwnProperty.call(deps, 'laravel/framework');
    } catch {
      return false;
    }
  },

  /**
   * Live-pipeline scan for Laravel dispatch patterns:
   *   [Controller::class, 'method']  → method on Controller
   *   Model::scope()                 → method on Model
   * @returns {object[]}
   */
  scanSource(src, file, graph) {
    const rels = [];
    const seen = new Set();
    const ctrlGlobal  = /\[\s*([A-Z][a-zA-Z]+Controller)\s*::\s*class\s*,\s*['"](\w+)['"]\s*\]/g;
    const modelGlobal = /\b([A-Z][a-zA-Z]+)::(\w+)\s*\(/g;

    let m;
    while ((m = ctrlGlobal.exec(src)) !== null) {
      const [, controller, method] = m;
      const line = src.slice(0, m.index).split('\n').length;
      const key = `${controller}.${method}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.findByName(method)) {
        if (s.parent === controller) { target = s; break; }
      }
      if (!target) continue;
      rels.push({
        _v: 1, _type: 'relation', from: file, to: target.id, kind: 'CALLS', line,
        _meta: { confidence: 0.88, resolvedBy: 'framework:laravel' },
      });
    }

    while ((m = modelGlobal.exec(src)) !== null) {
      const [, klass, method] = m;
      if (FACADE_NAMES.has(klass)) continue; // facade → skip (external)
      const line = src.slice(0, m.index).split('\n').length;
      const key = `${klass}.${method}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.findByName(method)) {
        if (s.parent === klass) { target = s; break; }
      }
      if (!target) continue;
      rels.push({
        _v: 1, _type: 'relation', from: file, to: target.id, kind: 'CALLS', line,
        _meta: { confidence: 0.85, resolvedBy: 'framework:laravel' },
      });
    }
    return rels;
  },

  resolve(ref, ctx) {
    if (!ref.contextText) return null;
    const txt = ref.contextText;

    // 1. [Controller::class, 'method'] → method on Controller class
    let m = CONTROLLER_TUPLE_RE.exec(txt);
    if (m) {
      const [, controller, method] = m;
      const candidates = lookupByParent(ctx.graph, controller, method);
      if (candidates.length) {
        const { candidate } = pickBest(ref, candidates);
        if (candidate) return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'calls', confidence: 0.88 };
      }
      return null;
    }

    // 2. Model::find() / scope → method on the class (NOT a facade)
    m = MODEL_STATIC_RE.exec(txt);
    if (m && !FACADE_NAMES.has(m[1])) {
      const [, klass, method] = m;
      let candidates = lookupByParent(ctx.graph, klass, method);
      if (!candidates.length) candidates = lookup(ctx.graph, klass); // fall back to class itself
      if (candidates.length) {
        const { candidate } = pickBest(ref, candidates);
        if (candidate) return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'calls', confidence: 0.85 };
      }
    }

    // 3. Facade::method → external — low confidence, marks it as known-pattern
    m = FACADE_RE.exec(txt);
    if (m) {
      const facadeName = m[1];
      const candidates = lookup(ctx.graph, facadeName);
      if (candidates.length) {
        const { candidate } = pickBest(ref, candidates);
        if (candidate) return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'calls', confidence: 0.7 };
      }
      return null;
    }

    // 4. route('name') → route definition (skipped — needs synthetic node, future)

    // 5. view('blade.path') → view file (skipped — same)

    return null;
  },
};
