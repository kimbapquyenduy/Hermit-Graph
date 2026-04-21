#!/usr/bin/env node
/**
 * hermit check-edit — Pre-edit impact check for one or more source files.
 *
 * Use case: IDE workflows (Cursor, VS Code, direct git) that bypass the AI and
 * its MCP tools. Run this in a terminal before editing to see the impact
 * surface of every exported/framework-bound symbol in the file.
 *
 * Usage:
 *   hermit check-edit <file>                        # Human-readable summary
 *   hermit check-edit <file1> <file2>               # Multi-file
 *   hermit check-edit <file> --verbose              # Include full caller list
 *   hermit check-edit <file> --format=json          # Machine-readable for CI
 *   hermit check-edit <file> --cwd /path/to/project # Override project root
 *
 * Pre-commit hook example:
 *   #!/bin/sh
 *   files=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|js|tsx|jsx|py)$')
 *   [ -n "$files" ] && echo "$files" | xargs hermit check-edit
 */

import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import * as codeIntel from './lib/code-intel/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Arg parsing ──

const args = process.argv.slice(2);
const flags = {
  verbose: false,
  format: 'text',
  // Honor HERMIT_USER_CWD set by brain-cli (since it forks with cwd=ROOT),
  // falling back to process.cwd() for direct invocation.
  cwd: process.env.HERMIT_USER_CWD || process.cwd(),
};
const files = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--verbose' || a === '-v') flags.verbose = true;
  else if (a.startsWith('--format=')) flags.format = a.slice('--format='.length);
  else if (a === '--format') flags.format = args[++i];
  else if (a.startsWith('--cwd=')) flags.cwd = resolve(a.slice('--cwd='.length));
  else if (a === '--cwd') flags.cwd = resolve(args[++i]);
  else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  else if (a.startsWith('-')) {
    console.error(`Unknown flag: ${a}`);
    process.exit(1);
  } else {
    files.push(a);
  }
}

if (files.length === 0) {
  printHelp();
  process.exit(1);
}

// ── Main ──

const dataDir = join(flags.cwd, 'data');
const projectRoot = flags.cwd;

// Build index if missing
const graphPath = codeIntel.codeGraphPath(dataDir);
if (!existsSync(graphPath)) {
  if (flags.format === 'text') {
    console.error(`Index missing — building for ${projectRoot}...`);
  }
  try {
    await codeIntel.fullIndex(projectRoot, dataDir);
  } catch (e) {
    console.error(`Failed to index: ${e.message}`);
    process.exit(1);
  }
}

const graph = codeIntel.readCodeGraph(dataDir);
const results = [];

for (const filePath of files) {
  // Resolve file path against the USER's cwd, not the fork's cwd
  const abs = resolve(projectRoot, filePath);
  const relPath = relative(projectRoot, abs).replace(/\\/g, '/');
  const symbols = [...graph.symbols.values()].filter(s => {
    const sf = (s.file || '').replace(/\\/g, '/');
    return sf === relPath || sf.endsWith('/' + relPath) || relPath.endsWith('/' + sf);
  });

  const fileResult = {
    file: relPath,
    absPath: abs,
    totalSymbols: symbols.length,
    riskyExports: [],
  };

  for (const s of symbols) {
    const isPublic = s.exported || isLikelyFrameworkBound(s);
    if (!isPublic) continue;

    const counts = codeIntel.impactCounts(graph, s.id, 'upstream');
    const frameworkBound = isLikelyFrameworkBound(s);
    if (counts.d1 === 0 && !frameworkBound) continue; // no signal

    const entry = {
      name: s.parent ? `${s.parent}.${s.name}` : s.name,
      kind: s.kind,
      line: s.line[0],
      d1: counts.d1,
      d2: counts.d2,
      d3: counts.d3,
      risk: counts.risk,
      frameworkBound,
    };
    if (flags.verbose) {
      entry.callers = graph.getCallers(s.id).slice(0, 20).map(c => ({
        name: c.name,
        file: c.file,
        line: c.line[0],
      }));
    }
    fileResult.riskyExports.push(entry);
  }

  // Sort: highest d1 first (most callers = most review needed)
  fileResult.riskyExports.sort((a, b) => b.d1 - a.d1);
  results.push(fileResult);
}

// ── Output ──

if (flags.format === 'json') {
  console.log(JSON.stringify({ cwd: projectRoot, files: results }, null, 2));
} else {
  printText(results, projectRoot);
}

// ── Helpers ──

function isLikelyFrameworkBound(symbol) {
  const file = symbol.file || '';
  const parent = symbol.parent || '';
  const fwDir = /\/(middleware|commands?|jobs?|handlers?|listeners?|tasks?|observers?|events?|hooks?|subscribers?)\//i;
  const fwMethod = new Set(['handle', 'run', 'execute', 'process', 'dispatch', 'invoke', 'perform', 'fire', 'trigger', 'exec', 'call', '__invoke']);
  if (fwDir.test(file) && fwMethod.has(symbol.name)) return true;
  if (symbol.kind === 'method' && /Controller$/.test(parent)) return true;
  if (symbol.kind === 'method' && /\/controllers?\//i.test(file)) return true;
  return false;
}

function printText(results, projectRoot) {
  console.log('');
  console.log(`Hermit check-edit — ${projectRoot}`);
  console.log('='.repeat(60));

  for (const r of results) {
    console.log('');
    console.log(`File: ${r.file}`);
    if (r.totalSymbols === 0) {
      console.log('  No symbols found. Is this file indexed? Run `hermit index`.');
      continue;
    }
    if (r.riskyExports.length === 0) {
      console.log(`  ${r.totalSymbols} symbols. No risky exports detected — safe to edit.`);
      continue;
    }
    console.log(`  ${r.totalSymbols} total symbols, ${r.riskyExports.length} with refactor risk:`);
    console.log('');
    for (const e of r.riskyExports) {
      const fb = e.frameworkBound ? ' [framework-bound]' : '';
      console.log(`  - ${e.name} (${e.kind}) @ :${e.line} — d=1:${e.d1} d=2:${e.d2} d=3:${e.d3} risk:${e.risk}${fb}`);
      if (e.callers && e.callers.length) {
        for (const c of e.callers.slice(0, 10)) {
          console.log(`      ← ${c.name} (${c.file}:${c.line})`);
        }
        if (e.callers.length > 10) console.log(`      ... ${e.callers.length - 10} more`);
      }
    }
  }

  console.log('');
  const totalRisky = results.reduce((a, r) => a + r.riskyExports.length, 0);
  const totalHigh = results.reduce((a, r) => a + r.riskyExports.filter(e => e.risk === 'HIGH').length, 0);
  console.log(`Summary: ${results.length} file(s), ${totalRisky} risky export(s), ${totalHigh} HIGH risk.`);
  if (totalHigh > 0) console.log('Tip: review HIGH-risk symbols with `hermit_impact` via your MCP-connected agent.');
  console.log('');
}

function printHelp() {
  console.log(`
Usage: hermit check-edit <file>... [options]

Pre-edit impact check for source files. Lists exported/framework-bound
symbols with their transitive caller counts so you know what will break.

Options:
  --verbose, -v         Include up to 20 direct callers per symbol
  --format <text|json>  Output format (default: text)
  --cwd <path>          Project root (default: current directory)
  --help, -h            This message

Examples:
  hermit check-edit src/auth/validate.ts
  hermit check-edit src/a.ts src/b.ts --verbose
  hermit check-edit src/auth/validate.ts --format=json | jq '.files[0].riskyExports'
`);
}
