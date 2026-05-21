/**
 * Phase 04 wave 2 — Rails framework resolver.
 *
 * Patterns:
 *   resources :products              — Rails REST routes (marker)
 *   get '/path' => 'controller#action'  — explicit route → controller method
 *   Model.find_by_X                  — dynamic finder (low-confidence skip)
 *   before_action :auth              — callback symbol
 *
 * Detection: Gemfile mentions rails.
 */

import { pickBest } from '../scoring.mjs';

const RAILS_ROUTE_RE = /\b(?:get|post|put|patch|delete)\s+['"][^'"]+['"]\s*=>\s*['"](\w+)#(\w+)['"]/;
const BEFORE_ACTION_RE = /\b(?:before_action|after_action|around_action)\s*:(\w+)/;

export const railsResolver = {
  name: 'rails',

  detect: async (projectRoot, fs) => {
    if (!projectRoot || !fs) return false;
    try {
      const gemfile = await fs.readFile(`${projectRoot}/Gemfile`, 'utf-8');
      return /\brails\b/.test(gemfile);
    } catch {
      return false;
    }
  },

  /**
   * Live-pipeline scan for Rails routes + before_action callbacks.
   * @returns {object[]}
   */
  scanSource(src, file, graph) {
    const rels = [];
    const seen = new Set();
    const routeGlobal    = /\b(?:get|post|put|patch|delete)\s+['"][^'"]+['"]\s*=>\s*['"](\w+)#(\w+)['"]/g;
    const callbackGlobal = /\b(?:before_action|after_action|around_action)\s*:(\w+)/g;

    const fileSymbols = [];
    for (const s of graph.symbols.values()) {
      if (s.file === file && (s.kind === 'method' || s.kind === 'function' || s.kind === 'class')) fileSymbols.push(s);
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
      const [, base, action] = m;
      const controllerName = base[0].toUpperCase() + base.slice(1) + 'Controller';
      const line = src.slice(0, m.index).split('\n').length;
      const key = `route:${controllerName}.${action}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.findByName(action)) {
        if (s.parent === controllerName) { target = s; break; }
      }
      if (!target) continue;
      rels.push({
        _v: 1, _type: 'relation', from: file, to: target.id, kind: 'CALLS', line,
        _meta: { confidence: 0.88, resolvedBy: 'framework:rails' },
      });
    }

    while ((m = callbackGlobal.exec(src)) !== null) {
      const method = m[1];
      const line = src.slice(0, m.index).split('\n').length;
      const key = `cb:${method}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let target = null;
      for (const s of graph.findByName(method)) {
        if (s.kind === 'method' || s.kind === 'function') { target = s; break; }
      }
      if (!target) continue;
      const fromId = enclosingId(line);
      if (fromId === target.id) continue;
      rels.push({
        _v: 1, _type: 'relation', from: fromId, to: target.id, kind: 'CALLS', line,
        _meta: { confidence: 0.8, resolvedBy: 'framework:rails' },
      });
    }
    return rels;
  },

  resolve(ref, ctx) {
    if (!ref.contextText) return null;
    const txt = ref.contextText;

    // get '/x' => 'controller#action' → ControllerController.action
    const route = RAILS_ROUTE_RE.exec(txt);
    if (route) {
      const [, controllerBase, action] = route;
      // Rails convention: 'users' → UsersController
      const controllerName = controllerBase[0].toUpperCase() + controllerBase.slice(1) + 'Controller';
      const candidates = [];
      for (const s of ctx.graph.symbols.values()) {
        if (s.name === action && s.parent === controllerName) candidates.push(s);
      }
      if (candidates.length) {
        const { candidate } = pickBest(ref, candidates);
        if (candidate) return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'calls', confidence: 0.88 };
      }
      return null;
    }

    // before_action :method_name → resolves to the method on the same class.
    const callback = BEFORE_ACTION_RE.exec(txt);
    if (callback) {
      const methodName = callback[1];
      const candidates = [];
      for (const s of ctx.graph.symbols.values()) {
        if (s.name === methodName && (s.kind === 'method' || s.kind === 'function')) candidates.push(s);
      }
      if (candidates.length) {
        const { candidate } = pickBest(ref, candidates);
        if (candidate) return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'calls', confidence: 0.8 };
      }
      return null;
    }

    return null;
  },
};
