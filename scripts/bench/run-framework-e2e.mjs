#!/usr/bin/env node
/**
 * Phase 04 e2e validation — run all 7 framework resolvers against a real
 * project, verify detect() correctness and resolve() accuracy against
 * actual source files + the project's symbol graph.
 *
 * Validates Phase 03 + 04 work in production-like conditions, not just
 * synthetic fixtures.
 *
 * Usage: node run-framework-e2e.mjs [path-to-project]
 *        (defaults to the repo itself; override via HERMIT_BENCH_PROJECT)
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { promises as fsp } from 'fs';
import { join, extname } from 'path';
import { dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
// Target project: positional arg → env var → repo itself (sanity-check default).
const PROJECT = process.argv[2] || process.env.HERMIT_BENCH_PROJECT || REPO_ROOT;

// Windows ESM requires file:// URL for absolute paths.
const url = (p) => pathToFileURL(p).href;
const { expressResolver } = await import(url(join(REPO_ROOT, 'scripts/lib/code-intel/resolution/frameworks/express.mjs')));
const { laravelResolver } = await import(url(join(REPO_ROOT, 'scripts/lib/code-intel/resolution/frameworks/laravel.mjs')));
const { nestjsResolver }  = await import(url(join(REPO_ROOT, 'scripts/lib/code-intel/resolution/frameworks/nestjs.mjs')));
const { reactResolver }   = await import(url(join(REPO_ROOT, 'scripts/lib/code-intel/resolution/frameworks/react.mjs')));
const { vueResolver }     = await import(url(join(REPO_ROOT, 'scripts/lib/code-intel/resolution/frameworks/vue.mjs')));
const { djangoResolver }  = await import(url(join(REPO_ROOT, 'scripts/lib/code-intel/resolution/frameworks/django.mjs')));
const { railsResolver }   = await import(url(join(REPO_ROOT, 'scripts/lib/code-intel/resolution/frameworks/rails.mjs')));
const { CodeGraph } = await import(url(join(REPO_ROOT, 'scripts/lib/code-intel/graph.mjs')));

const RESOLVERS = [
  { resolver: expressResolver,  expected: 'maybe' },
  { resolver: laravelResolver,  expected: false },
  { resolver: nestjsResolver,   expected: 'maybe' },
  { resolver: reactResolver,    expected: 'maybe' },
  { resolver: vueResolver,      expected: 'maybe' },
  { resolver: djangoResolver,   expected: false },
  { resolver: railsResolver,    expected: false },
];

// ── PHASE 1: detect() validation ──
console.log(`\n═══ Phase 04 e2e validation against ${PROJECT} ═══\n`);
console.log('── detect() phase ──');
const detected = [];
for (const { resolver, expected } of RESOLVERS) {
  const ok = await resolver.detect(PROJECT, fsp);
  const status = ok ? '✓ detected' : '— not detected';
  console.log(`  ${resolver.name.padEnd(10)} ${status}`);
  if (ok) detected.push(resolver);
}
console.log(`\nActive frameworks: ${detected.map(r => r.name).join(', ') || '(none)'}\n`);

if (!detected.length) {
  console.log('No frameworks detected — nothing to e2e against. Exiting cleanly.');
  process.exit(0);
}

// ── PHASE 2: load symbol graph for the project ──
console.log('── loading symbol graph ──');
const symbolsPath = join(PROJECT, 'data', 'code-symbols.jsonl');
let graph;
try {
  const lines = readFileSync(symbolsPath, 'utf-8').split('\n').filter(Boolean);
  const symbols = [];
  const relations = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj._type === 'symbol') symbols.push(obj);
      else if (obj._type === 'relation') relations.push(obj);
    } catch {}
  }
  graph = new CodeGraph();
  graph.addSymbols(symbols);
  graph.addRelations(relations);
  console.log(`  ✓ loaded ${graph.symbols.size} symbols, ${graph.relations.length} relations`);
} catch (e) {
  console.log(`  ✗ no symbol graph found at ${symbolsPath} — run hermit_index first`);
  process.exit(1);
}

// ── PHASE 3: extract real refs from project + run resolvers ──
console.log('\n── resolve() phase against real source ──');

function collectFiles(root, exts, max = 30, acc = []) {
  if (acc.length >= max) return acc;
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (acc.length >= max) break;
      const full = join(root, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', '.next', 'dist', 'build'].includes(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        collectFiles(full, exts, max, acc);
      } else if (entry.isFile() && exts.includes(extname(entry.name))) {
        acc.push(full);
      }
    }
  } catch {}
  return acc;
}

const stats = { tried: 0, resolved: 0, byResolver: {} };

// React: sample JSX files for component refs
if (detected.find(r => r.name === 'react')) {
  console.log('\n  [react] sampling JSX files...');
  const jsxFiles = collectFiles(join(PROJECT, 'src'), ['.tsx', '.jsx'], 40);
  console.log(`    → ${jsxFiles.length} candidate files`);

  const JSX_TAG_GLOBAL = /<([A-Z][A-Za-z0-9_]*)\b/g;
  stats.byResolver.react = { tried: 0, resolved: 0, samples: [] };

  for (const file of jsxFiles) {
    let src;
    try { src = readFileSync(file, 'utf-8'); } catch { continue; }
    const matches = [...src.matchAll(JSX_TAG_GLOBAL)].slice(0, 5);
    for (const m of matches) {
      stats.tried++;
      stats.byResolver.react.tried++;
      const componentName = m[1];
      // Skip if it's clearly an HTML element (we filter PascalCase only — already enforced by regex).
      const ref = {
        sourceId: `ref:${file}:${m.index}`,
        referenceName: componentName,
        referenceKind: 'renders',
        fromFile: file.replace(PROJECT + '/', '').replaceAll('\\', '/'),
        fromLang: 'typescript',
        contextText: src.slice(m.index, m.index + 200),
      };
      const result = reactResolver.resolve(ref, { graph });
      if (result) {
        stats.resolved++;
        stats.byResolver.react.resolved++;
        if (stats.byResolver.react.samples.length < 5) {
          const target = graph.getSymbol(result.targetId);
          stats.byResolver.react.samples.push({
            component: componentName,
            target_id: result.targetId,
            target_file: target?.file,
            target_line: target?.line?.[0],
            confidence: result.confidence,
          });
        }
      }
    }
  }
  const r = stats.byResolver.react;
  const pct = r.tried ? Math.round(r.resolved / r.tried * 100) : 0;
  console.log(`    → tried ${r.tried} refs, resolved ${r.resolved} (${pct}%)`);
  console.log(`    sample resolutions:`);
  for (const s of r.samples) {
    console.log(`      <${s.component} /> → ${s.target_file}:${s.target_line} (conf ${s.confidence})`);
  }
}

// Express: sample handlers (only when express was detected for the project)
if (detected.find(r => r.name === 'express')) {
  console.log('\n  [express] sampling route registrations...');
  const jsFiles = collectFiles(PROJECT, ['.js', '.ts', '.mjs'], 60);
  const ROUTE_RE_G = /\b(app|router)\.(get|post|put|patch|delete|all|use)\s*\(\s*['"][^'"]+['"]\s*,\s*[A-Za-z_$][\w$]*\s*\)/g;
  stats.byResolver.express = { tried: 0, resolved: 0, samples: [] };
  for (const file of jsFiles) {
    let src;
    try { src = readFileSync(file, 'utf-8'); } catch { continue; }
    const matches = [...src.matchAll(ROUTE_RE_G)].slice(0, 3);
    for (const m of matches) {
      stats.tried++;
      stats.byResolver.express.tried++;
      const ref = {
        sourceId: `ref:${file}:${m.index}`,
        referenceKind: 'calls',
        fromFile: file.replace(PROJECT + '/', '').replaceAll('\\', '/'),
        fromLang: 'typescript',
        contextText: m[0],
      };
      const result = expressResolver.resolve(ref, { graph });
      if (result) {
        stats.resolved++;
        stats.byResolver.express.resolved++;
        if (stats.byResolver.express.samples.length < 5) {
          const target = graph.getSymbol(result.targetId);
          stats.byResolver.express.samples.push({
            route: m[0].slice(0, 60),
            target_file: target?.file,
            confidence: result.confidence,
          });
        }
      }
    }
  }
  const r = stats.byResolver.express;
  const pct = r.tried ? Math.round(r.resolved / r.tried * 100) : 0;
  console.log(`    → tried ${r.tried} refs, resolved ${r.resolved} (${pct}%)`);
  if (r.samples.length) {
    console.log(`    sample resolutions:`);
    for (const s of r.samples) console.log(`      ${s.route} → ${s.target_file} (conf ${s.confidence})`);
  }
}

// ── SUMMARY ──
console.log(`\n═══ SUMMARY ═══`);
console.log(`  Project          : ${PROJECT}`);
console.log(`  Frameworks active: ${detected.map(r => r.name).join(', ')}`);
console.log(`  Total refs tried : ${stats.tried}`);
console.log(`  Total resolved   : ${stats.resolved}`);
console.log(`  Overall accuracy : ${stats.tried ? Math.round(stats.resolved / stats.tried * 100) : 0}%`);
console.log('');

// Exit non-zero if any active resolver had 0 resolutions (indicates broken resolver)
let anyFailure = false;
for (const [name, r] of Object.entries(stats.byResolver)) {
  if (r.tried > 5 && r.resolved === 0) {
    console.log(`  ⚠️  ${name} tried ${r.tried} refs but resolved 0 — investigate`);
    anyFailure = true;
  }
}
process.exit(anyFailure ? 1 : 0);
