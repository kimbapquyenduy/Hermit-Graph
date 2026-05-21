/**
 * Phase 04 wave 2 — NestJS framework resolver.
 *
 * Patterns:
 *   @Controller('/path')           — class decorator (resolves to class)
 *   @Get('/')/@Post/@Put/@Delete   — method decorators (route handlers)
 *   @Injectable()                  — DI service
 *   @Inject(TOKEN)                 — token-based DI
 *
 * Detection: package.json dep on @nestjs/common.
 */

import { pickBest } from '../scoring.mjs';

const NEST_METHOD_DECORATOR_RE = /@(Get|Post|Put|Patch|Delete|All|Options|Head)\s*\(/;
const NEST_CONTROLLER_RE        = /@Controller\s*\(/;
const NEST_INJECT_RE            = /@Inject\s*\(\s*([A-Z_][\w_]*)\s*\)/;

export const nestjsResolver = {
  name: 'nestjs',

  detect: async (projectRoot, fs) => {
    if (!projectRoot || !fs) return false;
    try {
      const pkg = JSON.parse(await fs.readFile(`${projectRoot}/package.json`, 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      return Object.prototype.hasOwnProperty.call(deps, '@nestjs/common')
          || Object.prototype.hasOwnProperty.call(deps, '@nestjs/core');
    } catch {
      return false;
    }
  },

  /**
   * Live-pipeline scan for NestJS @Inject(TOKEN) patterns.
   * @returns {object[]}
   */
  scanSource(src, file, graph) {
    const rels = [];
    const seen = new Set();
    const injGlobal = /@Inject\s*\(\s*([A-Z_][\w_]*)\s*\)/g;

    const fileSymbols = [];
    for (const s of graph.symbols.values()) {
      if (s.file === file && (s.kind === 'class' || s.kind === 'function' || s.kind === 'method')) fileSymbols.push(s);
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
    while ((m = injGlobal.exec(src)) !== null) {
      const token = m[1];
      const line = src.slice(0, m.index).split('\n').length;
      const key = `${token}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const matches = graph.findByName(token);
      const target = matches.length ? matches[0] : null;
      if (!target) continue;
      const fromId = enclosingId(line);
      if (fromId === target.id) continue;
      rels.push({
        _v: 1, _type: 'relation', from: fromId, to: target.id, kind: 'CALLS', line,
        _meta: { confidence: 0.88, resolvedBy: 'framework:nestjs' },
      });
    }
    return rels;
  },

  resolve(ref, ctx) {
    if (!ref.contextText) return null;
    const txt = ref.contextText;

    // @Inject(TOKEN) — resolve the token symbol.
    const inj = NEST_INJECT_RE.exec(txt);
    if (inj) {
      const tokenName = inj[1];
      const candidates = [];
      for (const s of ctx.graph.symbols.values()) {
        if (s.name === tokenName) candidates.push(s);
      }
      if (candidates.length) {
        const { candidate } = pickBest(ref, candidates);
        if (candidate) return { sourceId: ref.sourceId, targetId: candidate.id, kind: 'references', confidence: 0.88 };
      }
      return null;
    }

    // Controller / method decorators are SOURCE markers, not references —
    // they don't resolve a target. Return null so name strategy can handle
    // the actual call sites.
    if (NEST_CONTROLLER_RE.test(txt) || NEST_METHOD_DECORATOR_RE.test(txt)) {
      return null;
    }

    return null;
  },
};
