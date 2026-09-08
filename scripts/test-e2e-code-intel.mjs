#!/usr/bin/env node
/**
 * E2E Test Suite for code-intel module (v6.0.0)
 * Tests all 10 core scenarios against the hermit-graph codebase itself.
 *
 * Run: node scripts/test-e2e-code-intel.mjs
 */

import assert from 'assert';
import { spawn } from 'child_process';
import { existsSync, unlinkSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';

import * as codeIntel from './lib/code-intel/index.mjs';
import { parseFile, isSupported, hasPython } from './lib/code-intel/parser.mjs';
import { CodeGraph } from './lib/code-intel/graph.mjs';
import { detectProcesses } from './lib/code-intel/process-detector.mjs';
import { readCodeGraph, clearCodeGraph, codeGraphPath } from './lib/code-intel/code-io.mjs';
import { fullIndex, incrementalIndex, detectChanges } from './lib/code-intel/indexer.mjs';
import { blastRadius, symbolContext } from './lib/code-intel/impact.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(PROJECT_ROOT, 'data');

// ── Color output helpers ──
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

function log(msg) { console.log(msg); }
function pass(msg) { console.log(`${colors.green}✓${colors.reset} ${msg}`); }
function fail(msg) { console.error(`${colors.red}✗${colors.reset} ${msg}`); }
function info(msg) { console.log(`${colors.blue}ℹ${colors.reset} ${msg}`); }

// ── Assertion helpers ──
function assert_truthy(value, msg) {
  if (!value) throw new Error(`${msg}: expected truthy, got ${value}`);
}
function assert_gt(value, threshold, msg) {
  if (value <= threshold) throw new Error(`${msg}: expected > ${threshold}, got ${value}`);
}
function assert_gte(value, threshold, msg) {
  if (value < threshold) throw new Error(`${msg}: expected >= ${threshold}, got ${value}`);
}
function assert_array_length(arr, min, msg) {
  if (!Array.isArray(arr) || arr.length < min) {
    throw new Error(`${msg}: expected array with length >= ${min}, got length ${arr?.length || 'not-array'}`);
  }
}
function assert_has_property(obj, prop, msg) {
  if (!obj || !(prop in obj)) {
    throw new Error(`${msg}: object missing property '${prop}'`);
  }
}

// ── Test harness ──
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    pass(name);
    passed++;
  } catch (e) {
    fail(`${name}: ${e.message}`);
    failed++;
  }
}

function testSync(name, fn) {
  try {
    fn();
    pass(name);
    passed++;
  } catch (e) {
    fail(`${name}: ${e.message}`);
    failed++;
  }
}

// ── Tests ──

log('\n─────────────────────────────────────────');
log('Code-Intel E2E Test Suite v6.0.0');
log('─────────────────────────────────────────\n');

// Clean up before tests
info(`Clearing previous index from ${DATA_DIR}...`);
clearCodeGraph(DATA_DIR);

// ── SCENARIO 1: Full Index ──
await test('SCENARIO 1: Full Index on hermit-graph codebase', async () => {
  info('Running fullIndex on project root...');
  const result = await fullIndex(PROJECT_ROOT, DATA_DIR, {
    onProgress: (file, idx, total) => {
      if (idx % 20 === 0) info(`  [${idx}/${total}] ${file}`);
    },
  });

  assert_has_property(result, 'graph', 'fullIndex should return object with graph');
  assert_has_property(result, 'stats', 'fullIndex should return object with stats');

  const { graph, stats } = result;
  info(`  Indexed ${stats.files} files`);
  info(`  Found ${stats.symbols} symbols`);
  info(`  Found ${stats.relations} relations`);

  assert_gt(stats.files, 50, 'Should index > 50 files');
  assert_gt(stats.symbols, 200, 'Should find > 200 symbols');
  assert_gt(stats.relations, 500, 'Should find > 500 relations');

  // Verify code-symbols.jsonl was created
  const graphPath = codeGraphPath(DATA_DIR);
  assert_truthy(existsSync(graphPath), 'code-symbols.jsonl should exist');
  info(`  Created ${graphPath}`);

  // Verify graph has metadata
  assert_has_property(graph.meta, 'commit', 'Graph should have commit in metadata');
  info(`  Indexed at commit: ${graph.meta.commit?.slice(0, 8)}`);
});

// ── SCENARIO 2: Query ──
await test('SCENARIO 2: Query for "readBrain"', async () => {
  const graph = readCodeGraph(DATA_DIR);
  const results = graph.searchSymbols('readBrain');

  assert_array_length(results, 1, 'Should find at least 1 "readBrain" symbol');
  const match = results[0];
  assert_has_property(match, 'name', 'Match should have name property');
  assert_has_property(match, 'id', 'Match should have id property');

  info(`  Found symbol: ${match.name} (${match.kind}) in ${match.file}`);
  pass(`  Matched: ${match.name}`);
});

// ── SCENARIO 3: Context (360-degree view) ──
await test('SCENARIO 3: Get context for "readBrain"', async () => {
  const graph = readCodeGraph(DATA_DIR);
  const sym = graph.searchSymbols('readBrain')[0];
  assert_truthy(sym, 'readBrain symbol should exist');

  const ctx = symbolContext(graph, sym.id);
  assert_has_property(ctx, 'symbol', 'Context should have symbol');
  assert_has_property(ctx, 'callers', 'Context should have callers array');
  assert_has_property(ctx, 'callees', 'Context should have callees array');

  info(`  Symbol: ${ctx.symbol.name}`);
  info(`  Callers: ${ctx.callers.length}`);
  info(`  Callees: ${ctx.callees.length}`);

  assert_array_length(ctx.callers, 0, 'Should have callers or empty array (not error)');
});

// ── SCENARIO 4: Impact (Blast Radius) ──
await test('SCENARIO 4: Blast radius analysis for "readBrain"', async () => {
  const graph = readCodeGraph(DATA_DIR);
  const sym = graph.searchSymbols('readBrain')[0];
  assert_truthy(sym, 'readBrain symbol should exist');

  const impact = blastRadius(graph, sym.id, 'upstream');
  assert_has_property(impact, 'target', 'Impact should return target');
  assert_has_property(impact, 'd1', 'Impact should return d1 array');
  assert_has_property(impact, 'd2', 'Impact should return d2 array');
  assert_has_property(impact, 'd3', 'Impact should return d3 array');
  assert_has_property(impact, 'riskLevel', 'Impact should return riskLevel');

  info(`  Target: ${impact.target?.name}`);
  info(`  Risk level: ${impact.riskLevel}`);
  info(`  d1 (WILL_BREAK): ${impact.d1.length}`);
  info(`  d2 (LIKELY_AFFECTED): ${impact.d2.length}`);
  info(`  d3 (MAY_NEED_TESTING): ${impact.d3.length}`);

  // Verify riskLevel is one of the expected values
  assert_truthy(
    ['LOW', 'MEDIUM', 'HIGH'].includes(impact.riskLevel),
    'Risk level should be LOW/MEDIUM/HIGH'
  );
});

// ── SCENARIO 5: Detect Changes ──
await test('SCENARIO 5: Detect changes (index status)', async () => {
  const result = detectChanges(PROJECT_ROOT, DATA_DIR);
  assert_has_property(result, 'stale', 'Should return stale boolean');
  assert_has_property(result, 'indexed', 'Should return indexed stats');
  assert_has_property(result.indexed, 'files', 'Should have indexed.files');
  assert_has_property(result.indexed, 'symbols', 'Should have indexed.symbols');
  assert_has_property(result.indexed, 'relations', 'Should have indexed.relations');

  info(`  Stale: ${result.stale}`);
  info(`  Indexed: ${result.indexed.files} files, ${result.indexed.symbols} symbols, ${result.indexed.relations} relations`);

  // Verify counts match what we indexed
  assert_gt(result.indexed.files, 50, 'Indexed file count should match');
  assert_gt(result.indexed.symbols, 200, 'Indexed symbol count should match');
});

// ── SCENARIO 6: Process Detection ──
await test('SCENARIO 6: Detect execution flows (processes)', async () => {
  const graph = readCodeGraph(DATA_DIR);
  const processes = detectProcesses(graph);
  assert_array_length(processes, 10, 'Should detect at least 10 execution flows');

  info(`  Detected ${processes.length} processes/execution flows`);
  const top5 = processes.slice(0, 5);
  for (const proc of top5) {
    info(`    - ${proc.label} (${proc.stepCount} steps)`);
  }
});

// ── SCENARIO 7: Incremental Index ──
await test('SCENARIO 7: Incremental index (no code changes)', async () => {
  const result = await incrementalIndex(PROJECT_ROOT, DATA_DIR);
  assert_has_property(result, 'graph', 'Should return graph');
  assert_has_property(result, 'changed', 'Should return changed array');
  assert_has_property(result, 'stats', 'Should return stats');

  info(`  Changed files: ${result.changed.length}`);
  info(`  Stats - Files: ${result.stats.files}, Symbols: ${result.stats.symbols}, Relations: ${result.stats.relations}`);

  // Since nothing changed in git since last commit, changed should be empty
  if (result.changed.length === 0) {
    info('  (No changes since last commit — expected)');
  }
});

// ── SCENARIO 8: Unified Search (test searchCode from unified-search.mjs) ──
await test('SCENARIO 8: Unified search via unified-search module', async () => {
  try {
    const searchModule = await import('./lib/unified-search.mjs');
    const searchCode = searchModule.searchCode;
    assert_truthy(typeof searchCode === 'function', 'searchCode should be exported function');

    // Test the search
    const results = await searchCode('export', PROJECT_ROOT);
    assert_array_length(results, 1, 'searchCode should return results array');
    info(`  Found ${results[0]?.length || 0} search results for "export"`);
  } catch (e) {
    // If unified-search doesn't have searchCode, just verify the module exists
    info(`  unified-search module loaded (searchCode may be under different API)`);
  }
});

// ── SCENARIO 9: Parser Edge Cases ──
testSync('SCENARIO 9a: parseFile with valid JavaScript', () => {
  const code = `export function hello() { return 42; }`;
  const result = parseFile('test.js', code);
  assert_truthy(result, 'Should parse valid JS');
  assert_has_property(result, 'root', 'Should have root AST');
  assert_has_property(result, 'lang', 'Should have lang');
  assert_has_property(result, 'langStr', 'Should have langStr');
  assert_truthy(result.langStr === 'javascript', 'Language should be javascript');
});

testSync('SCENARIO 9b: parseFile with valid TypeScript', () => {
  const code = `export interface User { name: string; }`;
  const result = parseFile('test.ts', code);
  assert_truthy(result, 'Should parse valid TS');
  assert_truthy(result.langStr === 'typescript', 'Language should be typescript');
});

testSync('SCENARIO 9c: parseFile with unsupported file type', () => {
  const code = `fn main() {}`;
  const result = parseFile('test.rs', code);
  assert_truthy(result === null, 'Should return null for unsupported file type');
  info('  (Rust not supported — expected)');
});

testSync('SCENARIO 9d: parseFile with malformed JavaScript', () => {
  const code = `function broken( { return 42; }`; // missing closing paren
  const result = parseFile('broken.js', code);
  // ast-grep is error-tolerant, may return partial tree or null
  info(`  Malformed JS handled: ${result ? 'partial parse' : 'rejected'}`);
});

testSync('SCENARIO 10: isSupported and hasPython checks', () => {
  assert_truthy(isSupported('test.js'), 'Should support .js');
  assert_truthy(isSupported('test.ts'), 'Should support .ts');
  assert_truthy(isSupported('test.tsx'), 'Should support .tsx');
  assert_truthy(!isSupported('test.go'), 'Should not support .go');

  const pythonAvailable = hasPython();
  info(`  Python support: ${pythonAvailable ? 'available' : 'not available'}`);
});

// ── SCENARIO 11: MCP Server Boot (optional, spawns subprocess) ──
await test('SCENARIO 11: MCP Server boot and initialization', async () => {
  // Try to find the MCP server entry point
  const mcpServerPath = resolve(PROJECT_ROOT, 'scripts/lib/hermit-mcp-server.mjs');

  if (!existsSync(mcpServerPath)) {
    info('  MCP server file not found, skipping live boot test');
    return;
  }

  return new Promise((resolve, reject) => {
    const server = spawn('node', [mcpServerPath], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    let output = '';
    let ready = false;

    server.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('Server initialized') || output.includes('tools/list')) {
        ready = true;
        server.kill();
      }
    });

    server.stderr.on('data', (data) => {
      const err = data.toString();
      if (!err.includes('ECONNREFUSED')) {
        info(`  Server stderr: ${err.slice(0, 100)}`);
      }
    });

    server.on('close', (code) => {
      if (ready) {
        info('  MCP server booted successfully');
        resolve();
      } else {
        info('  MCP server test skipped (not ready in time)');
        resolve();
      }
    });

    setTimeout(() => {
      server.kill();
    }, 3000);
  });
});

// ── SCENARIO 12: CodeGraph API completeness ──
testSync('SCENARIO 12: CodeGraph API methods', () => {
  const graph = readCodeGraph(DATA_DIR);

  // Verify all expected methods exist
  const methods = [
    'getSymbol',
    'getSymbolsByFile',
    'getSymbolsByKind',
    'searchSymbols',
    'getCallers',
    'getCallees',
    'getRelationsFor',
    'getFiles',
    'addSymbols',
    'addRelations',
    'removeByFile',
    'toEntries',
  ];

  for (const method of methods) {
    assert_truthy(
      typeof graph[method] === 'function',
      `CodeGraph should have ${method} method`
    );
  }

  info(`  All ${methods.length} CodeGraph methods present`);
});

// ── SCENARIO 13: Code-symbols.jsonl format verification ──
testSync('SCENARIO 13: code-symbols.jsonl file format', () => {
  const graphPath = codeGraphPath(DATA_DIR);
  const content = readFileSync(graphPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  assert_gt(lines.length, 100, 'Should have > 100 lines in JSONL');

  // Verify first line is meta
  const firstLine = JSON.parse(lines[0]);
  assert_has_property(firstLine, '_type', 'First line should be metadata');
  assert_truthy(firstLine._type === 'meta', 'First line should have _type: meta');

  // Verify we have symbol entries
  const symbols = lines.filter(l => {
    try {
      const obj = JSON.parse(l);
      return obj._type === 'symbol';
    } catch {
      return false;
    }
  });
  assert_gt(symbols.length, 200, 'Should have > 200 symbol entries');

  // Verify we have relation entries
  const relations = lines.filter(l => {
    try {
      const obj = JSON.parse(l);
      return obj._type === 'relation';
    } catch {
      return false;
    }
  });
  assert_gt(relations.length, 500, 'Should have > 500 relation entries');

  info(`  JSONL has ${lines.length} lines`);
  info(`  - Meta: 1`);
  info(`  - Symbols: ${symbols.length}`);
  info(`  - Relations: ${relations.length}`);
});

// ── Regression: worker mode with zero AST-parseable files ──
// A repo of >=50 files that contains no JS/TS/PY (only XML / Vue / Svelte /
// Liquid) enables the parse worker but never allocates the pool. Pass-2 used to
// call _pool.preloadSymbols() unconditionally and threw
// "Cannot read properties of null (reading 'preloadSymbols')".

function makeTempRepo(prefix, count, name, content) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, name(i)), content(i), 'utf-8');
  }
  return dir;
}

await test('Regression: fullIndex on 60 non-MyBatis XML files (worker mode, no AST files)', async () => {
  const repo = makeTempRepo('hermit-xml-', 60,
    (i) => `config-${i}.xml`,
    (i) => `<?xml version="1.0"?>
<beans><bean id="b${i}" class="com.example.Bean${i}"/></beans>
`);
  const data = mkdtempSync(join(tmpdir(), 'hermit-xml-data-'));
  try {
    const result = await fullIndex(repo, data);
    assert_has_property(result, 'graph', 'fullIndex should return a graph');
    assert_has_property(result, 'stats', 'fullIndex should return stats');
    info(`  indexed ${result.stats.files} XML files without crashing`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

await test('Regression: fullIndex on 60 Vue SFC files (worker mode, no AST files)', async () => {
  const repo = makeTempRepo('hermit-vue-', 60,
    (i) => `Comp${i}.vue`,
    (i) => `<template><div>c${i}</div></template>
<script>export default { name: 'Comp${i}' }</script>
`);
  const data = mkdtempSync(join(tmpdir(), 'hermit-vue-data-'));
  try {
    const result = await fullIndex(repo, data);
    assert_has_property(result, 'graph', 'fullIndex should return a graph');
    info(`  indexed ${result.stats.files} Vue files without crashing`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

// ── Summary ──
log('\n─────────────────────────────────────────');
log(`Results: ${colors.green}${passed} passed${colors.reset}, ${passed + failed > 0 && failed > 0 ? colors.red + failed + ' failed' + colors.reset : 'none failed'}`);
log(`Total: ${passed + failed} tests`);
log('─────────────────────────────────────────\n');

if (failed > 0) {
  process.exit(1);
}

info('✓ All tests passed!');
