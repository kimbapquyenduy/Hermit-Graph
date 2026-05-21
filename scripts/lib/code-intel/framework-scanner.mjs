/**
 * Phase 03 wave 2 — framework-scanner: live-pipeline integration.
 *
 * Runs each detected framework resolver globally over project source files
 * and emits new relations that the AST extractor misses (JSX renders,
 * Laravel controller dispatches, etc.). Sits in indexer pass-3, after
 * AST extraction has populated the symbol graph.
 *
 * Each resolver exposes:
 *   - detect(projectRoot, fsp) → bool
 *   - scanSource(src, file, graph) → relation[]
 *
 * scanSource runs the resolver's regex with /g flag and emits one relation
 * per match where the target resolves in the graph.
 */

import { readFileSync, promises as fsp, readdirSync } from 'fs';
import { join, extname } from 'path';

// Framework resolvers can declare extra extensions they want to scan beyond
// the AST extractor's supported set (e.g. .vue templates, .blade.php, .erb).
// Keyed by resolver name.
const FRAMEWORK_EXTRA_EXTS = {
  vue:     ['.vue'],
  svelte:  ['.svelte'],
  laravel: ['.blade.php', '.php'],
  rails:   ['.erb', '.rb'],
  django:  ['.html', '.py'],
};

// Walk project for framework-specific files (skipping common ignored dirs).
function collectExtraFiles(projectRoot, exts, max = 5000) {
  const out = [];
  function walk(rel) {
    if (out.length >= max) return;
    let entries;
    try { entries = readdirSync(join(projectRoot, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max) break;
      const next = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'vendor', '__pycache__', '.venv'].includes(e.name)) continue;
        if (e.name.startsWith('.')) continue;
        walk(next);
      } else if (e.isFile()) {
        const ext = extname(e.name).toLowerCase();
        // Support multi-segment exts like ".blade.php"
        if (exts.includes(ext) || exts.some(x => e.name.toLowerCase().endsWith(x))) out.push(next);
      }
    }
  }
  walk('');
  return out;
}

let _resolvers = null;
async function loadResolvers() {
  if (_resolvers) return _resolvers;
  _resolvers = [
    (await import('./resolution/frameworks/express.mjs')).expressResolver,
    (await import('./resolution/frameworks/laravel.mjs')).laravelResolver,
    (await import('./resolution/frameworks/nestjs.mjs')).nestjsResolver,
    (await import('./resolution/frameworks/react.mjs')).reactResolver,
    (await import('./resolution/frameworks/vue.mjs')).vueResolver,
    (await import('./resolution/frameworks/django.mjs')).djangoResolver,
    (await import('./resolution/frameworks/rails.mjs')).railsResolver,
    (await import('./resolution/frameworks/svelte.mjs')).svelteResolver,
  ];
  return _resolvers;
}

/**
 * Detect which framework resolvers apply to a project. Runs each resolver's
 * detect() against the project's package config files.
 * @param {string} projectRoot
 * @returns {Promise<object[]>} active resolver array
 */
export async function detectActiveFrameworks(projectRoot) {
  const resolvers = await loadResolvers();
  const active = [];
  for (const r of resolvers) {
    try {
      if (await r.detect(projectRoot, fsp)) active.push(r);
    } catch {}
  }
  return active;
}

/**
 * Run the framework post-pass against a list of project files.
 * For each active framework, scan each file source globally for the
 * resolver's patterns and emit new relations into the graph.
 *
 * @param {string} projectRoot
 * @param {string[]} files — relative paths
 * @param {import('./graph.mjs').CodeGraph} graph
 * @param {object} [opts]
 * @param {Function} [opts.onProgress]
 * @returns {Promise<{ active: string[], added: number, byFramework: Object<string, number> }>}
 */
export async function runFrameworkPass(projectRoot, files, graph, opts = {}) {
  const active = await detectActiveFrameworks(projectRoot);
  if (!active.length) return { active: [], added: 0, byFramework: {} };

  const byFramework = {};
  let added = 0;

  // Collect per-resolver file pool: AST-supported files + framework-specific
  // extra files (e.g. .vue, .blade.php) that the AST extractor skipped.
  const resolverFiles = new Map();
  for (const resolver of active) {
    const extraExts = FRAMEWORK_EXTRA_EXTS[resolver.name] || [];
    const extras = extraExts.length ? collectExtraFiles(projectRoot, extraExts) : [];
    // Dedupe — AST files may overlap (Laravel uses .php; Vue .vue is new).
    const pool = new Set([...files, ...extras]);
    resolverFiles.set(resolver.name, [...pool]);
  }

  const seenFiles = new Set();
  for (const [resolverName, pool] of resolverFiles) for (const f of pool) seenFiles.add(f);
  const allFiles = [...seenFiles];

  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i];
    let src;
    try {
      src = readFileSync(join(projectRoot, file), 'utf-8');
    } catch { continue; }
    if (src.length > 500_000) continue;

    for (const resolver of active) {
      if (typeof resolver.scanSource !== 'function') continue;
      const pool = resolverFiles.get(resolver.name);
      if (!pool.includes(file)) continue;
      let rels;
      try {
        rels = resolver.scanSource(src, file, graph) || [];
      } catch { rels = []; }
      if (!rels.length) continue;
      graph.addRelations(rels);
      added += rels.length;
      byFramework[resolver.name] = (byFramework[resolver.name] || 0) + rels.length;
    }
    opts.onProgress?.(file, i + 1, allFiles.length);
  }

  return {
    active: active.map(r => r.name),
    added,
    byFramework,
  };
}
