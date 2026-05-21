#!/usr/bin/env node
/**
 * Hermit Graph v4 Test Suite
 * Tests: brain-io, audit-trail, branch-context, migration, health-check,
 * gitnexus-runner, command-export, hook-export, MCP server integration,
 * skill-index, skill-search, recall-core (token budget + task detection),
 * entity-extractor (post-response KG update).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TMP = join(ROOT, 'tmp', 'test-v4');
const REAL_BRAIN = join(ROOT, 'data', 'brain.jsonl');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

let passed = 0, failed = 0, skipped = 0;

function setup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP, { recursive: true });
}

function cleanup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

function writeTempBrain(name, entities, relations = []) {
  const path = join(TMP, name);
  const lines = [
    ...entities.map(e => JSON.stringify({ type: 'entity', ...e })),
    ...relations.map(r => JSON.stringify({ type: 'relation', ...r })),
  ];
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
}

// ══════════════════════════════════════════════════════════════════════════
// 1. BRAIN-IO TESTS
// ══════════════════════════════════════════════════════════════════════════

async function brainIoTests() {
  console.log('\n📦 Brain I/O Tests');
  const { readBrain, writeBrain, withBrainLock } = await import('./lib/brain-io.mjs');

  await test('readBrain: parses entities and relations', () => {
    const path = writeTempBrain('bio-1.jsonl',
      [{ name: 'E1', entityType: 'tech-stack', observations: ['obs1'] }],
      [{ from: 'E1', to: 'E2', relationType: 'uses' }]
    );
    const { entities, relations } = readBrain(path);
    assert(entities.size === 1, `Expected 1 entity, got ${entities.size}`);
    assert(relations.length === 1, `Expected 1 relation, got ${relations.length}`);
    assert(entities.get('E1').entityType === 'tech-stack');
  });

  await test('readBrain: returns empty on missing file', () => {
    const { entities, relations } = readBrain(join(TMP, 'nonexistent.jsonl'));
    assert(entities.size === 0);
    assert(relations.length === 0);
  });

  await test('readBrain: skips malformed lines', () => {
    const path = join(TMP, 'bio-3.jsonl');
    writeFileSync(path, '{"type":"entity","name":"A","entityType":"t","observations":[]}\nBAD_JSON\n{"type":"relation","from":"A","to":"B","relationType":"r"}\n');
    const { entities, relations } = readBrain(path);
    assert(entities.size === 1);
    assert(relations.length === 1);
  });

  await test('writeBrain: creates directory if needed', () => {
    const path = join(TMP, 'subdir', 'nested', 'brain.jsonl');
    const entities = new Map([['X', { type: 'entity', name: 'X', entityType: 't', observations: [] }]]);
    writeBrain(path, entities, []);
    assert(existsSync(path));
    const content = readFileSync(path, 'utf-8');
    assert(content.includes('"name":"X"'));
  });

  await test('withBrainLock: serializes concurrent writes', async () => {
    const path = writeTempBrain('bio-5.jsonl', [{ name: 'C', entityType: 't', observations: ['init'] }]);
    const results = [];
    await Promise.all([
      withBrainLock(path, () => { results.push(1); }),
      withBrainLock(path, () => { results.push(2); }),
    ]);
    assert(results.length === 2, 'Both writes completed');
  });

  await test('readBrain: real brain.jsonl loads successfully', () => {
    if (!existsSync(REAL_BRAIN)) { skipped++; return; }
    const { entities, relations } = readBrain(REAL_BRAIN);
    assert(entities.size > 0, `Expected entities, got ${entities.size}`);
    assert(relations.length > 0, `Expected relations, got ${relations.length}`);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 2. AUDIT TRAIL TESTS
// ══════════════════════════════════════════════════════════════════════════

async function auditTrailTests() {
  console.log('\n📜 Audit Trail Tests');
  const { normalizeObservation, appendHistory, archiveObservation, getEntityHistory } = await import('./lib/audit-trail.mjs');

  await test('normalizeObservation: string → object', () => {
    const result = normalizeObservation('[0.9|2026-04-01] test');
    assert(result.content === '[0.9|2026-04-01] test');
    assert(result._branch === null);
    assert(result._archived === false);
    assert(Array.isArray(result._history) && result._history.length === 0);
  });

  await test('normalizeObservation: object passthrough', () => {
    const input = { content: 'x', _branch: 'main', _archived: true, _archivedAt: '2026', _history: [{ content: 'old' }] };
    const result = normalizeObservation(input);
    assert(result._branch === 'main');
    assert(result._archived === true);
    assert(result._history.length === 1);
  });

  await test('appendHistory: saves previous content', () => {
    const result = appendHistory('[0.9|2026-04-01] old text', 'updated');
    assert(result._history.length === 1);
    assert(result._history[0].content === '[0.9|2026-04-01] old text');
    assert(result._history[0].reason === 'updated');
    assert(result._history[0].changedAt);
  });

  await test('appendHistory: caps at 50 entries', () => {
    let obs = { content: 'test', _history: Array(55).fill({ content: 'old', changedAt: '2026-01-01', reason: 'updated' }) };
    const result = appendHistory(obs, 'updated');
    assert(result._history.length === 50, `Expected 50, got ${result._history.length}`);
  });

  await test('archiveObservation: sets _archived + history', () => {
    const result = archiveObservation('old obs text');
    assert(result._archived === true);
    assert(result._archivedAt);
    assert(result._history.length === 1);
    assert(result._history[0].reason === 'archived');
  });

  await test('getEntityHistory: collects from all observations', () => {
    const entity = {
      name: 'E1',
      observations: [
        { content: 'a', _history: [{ content: 'a0', changedAt: '2026-04-01T10:00:00Z', reason: 'updated' }] },
        { content: 'b', _history: [{ content: 'b0', changedAt: '2026-04-02T10:00:00Z', reason: 'archived' }] },
      ],
    };
    const history = getEntityHistory(entity);
    assert(history.length === 2);
    assert(history[0].changedAt > history[1].changedAt, 'Should be newest-first');
  });

  await test('getEntityHistory: empty on no history', () => {
    const history = getEntityHistory({ name: 'E', observations: ['string obs'] });
    assert(history.length === 0);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 3. BRANCH CONTEXT TESTS
// ══════════════════════════════════════════════════════════════════════════

async function branchContextTests() {
  console.log('\n🌿 Branch Context Tests');
  const { detectBranch, getBranchFilter, setBranchFilter, clearBranchFilter, isObservationVisible } = await import('./lib/branch-context.mjs');

  await test('detectBranch: returns branch name', () => {
    const branch = detectBranch(ROOT);
    assert(typeof branch === 'string' && branch.length > 0, `Got: ${branch}`);
    assert(branch !== 'unknown', 'Should detect branch in git repo');
  });

  await test('detectBranch: returns unknown for non-git dir', () => {
    const branch = detectBranch('/tmp');
    assert(branch === 'unknown', `Expected unknown, got: ${branch}`);
  });

  await test('setBranchFilter + getBranchFilter', () => {
    setBranchFilter('feature/test');
    assert(getBranchFilter() === 'feature/test');
    clearBranchFilter();
    assert(getBranchFilter() === null);
  });

  await test('isObservationVisible: no filter shows all', () => {
    assert(isObservationVisible('string obs', null) === true);
    assert(isObservationVisible({ content: 'x', _branch: 'other' }, null) === true);
  });

  await test('isObservationVisible: filter matches branch', () => {
    assert(isObservationVisible({ content: 'x', _branch: 'main' }, 'main') === true);
    assert(isObservationVisible({ content: 'x', _branch: null }, 'main') === true);
    assert(isObservationVisible({ content: 'x', _branch: 'other' }, 'main') === false);
  });

  await test('isObservationVisible: string obs always visible with filter', () => {
    assert(isObservationVisible('plain string', 'feature/x') === true);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 4. MIGRATION TESTS
// ══════════════════════════════════════════════════════════════════════════

async function migrationTests() {
  console.log('\n🔄 Migration Tests');

  await test('migration: converts string observations to objects', () => {
    const path = writeTempBrain('mig-1.jsonl', [
      { name: 'A', entityType: 'tech-stack', observations: ['[0.9|2026-04-01] test obs', 'plain text'] },
    ]);
    // Run migration inline (same logic as migrate-v3-to-v4.mjs)
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    const migrated = lines.map(line => {
      const obj = JSON.parse(line);
      if (obj.type === 'entity') {
        obj.observations = obj.observations.map(obs => {
          if (typeof obs === 'string') return { content: obs, _branch: null, _archived: false, _archivedAt: null, _history: [] };
          return obs;
        });
      }
      return JSON.stringify(obj);
    });
    writeFileSync(path, migrated.join('\n') + '\n');

    // Verify
    const result = JSON.parse(readFileSync(path, 'utf-8').split('\n')[0]);
    assert(typeof result.observations[0] === 'object');
    assert(result.observations[0].content === '[0.9|2026-04-01] test obs');
    assert(result.observations[0]._branch === null);
    assert(result.observations[1].content === 'plain text');
  });

  await test('migration: idempotent (run twice = same result)', () => {
    const path = writeTempBrain('mig-2.jsonl', [
      { name: 'B', entityType: 't', observations: ['obs1'] },
    ]);
    // Migrate once
    const migrate = (p) => {
      const lines = readFileSync(p, 'utf-8').split('\n').filter(Boolean);
      const result = lines.map(line => {
        const obj = JSON.parse(line);
        if (obj.type === 'entity') {
          obj.observations = obj.observations.map(obs =>
            typeof obs === 'string' ? { content: obs, _branch: null, _archived: false, _archivedAt: null, _history: [] } : obs
          );
        }
        return JSON.stringify(obj);
      });
      writeFileSync(p, result.join('\n') + '\n');
    };
    migrate(path);
    const after1 = readFileSync(path, 'utf-8');
    migrate(path);
    const after2 = readFileSync(path, 'utf-8');
    assert(after1 === after2, 'Second migration should produce identical output');
  });

  await test('migration: handles empty brain.jsonl', () => {
    const path = join(TMP, 'mig-3.jsonl');
    writeFileSync(path, '');
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    assert(lines.length === 0);
  });

  await test('migration: preserves relations', () => {
    const path = writeTempBrain('mig-4.jsonl',
      [{ name: 'X', entityType: 't', observations: ['obs'] }],
      [{ from: 'X', to: 'Y', relationType: 'uses' }]
    );
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    const migrated = lines.map(line => {
      const obj = JSON.parse(line);
      if (obj.type === 'entity') {
        obj.observations = obj.observations.map(obs =>
          typeof obs === 'string' ? { content: obs, _branch: null, _archived: false, _archivedAt: null, _history: [] } : obs
        );
      }
      return JSON.stringify(obj);
    });
    writeFileSync(path, migrated.join('\n') + '\n');
    const result = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    const rel = JSON.parse(result[1]);
    assert(rel.type === 'relation');
    assert(rel.from === 'X');
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 5. HEALTH CHECK TESTS
// ══════════════════════════════════════════════════════════════════════════

async function healthCheckTests() {
  console.log('\n🏥 Health Check Tests');
  const { loadBrain, checkStale, checkDuplicates, checkOrphans, checkLowConfidence, calculateHealth } = await import('./lib/brain-health-checks.mjs');

  await test('checkDuplicates: detects case-insensitive dupes', () => {
    const entities = [
      { name: 'A:B:C', entityType: 't', observations: [] },
      { name: 'a:b:c', entityType: 't', observations: [] },
    ];
    const result = checkDuplicates(entities);
    assert(!result.passed, 'Should fail with duplicate');
    assert(result.violationCount === 1);
  });

  await test('checkDuplicates: passes on unique names', () => {
    const entities = [
      { name: 'A', entityType: 't', observations: [] },
      { name: 'B', entityType: 't', observations: [] },
    ];
    assert(checkDuplicates(entities).passed);
  });

  await test('checkOrphans: detects unlinked entities', () => {
    const entities = [
      { name: 'A', entityType: 't', observations: [] },
      { name: 'B', entityType: 't', observations: [] },
    ];
    const result = checkOrphans(entities, []);
    assert(result.violationCount === 2, 'Both should be orphans');
  });

  await test('calculateHealth: perfect score on clean data', () => {
    const checks = [
      { name: 'Test', passed: true, violationCount: 0, totalCount: 10, weight: 1.0 },
    ];
    assert(calculateHealth(checks) === 100);
  });

  await test('calculateHealth: penalizes failures', () => {
    const checks = [
      { name: 'Test', passed: false, violationCount: 5, totalCount: 10, weight: 0.5 },
    ];
    const score = calculateHealth(checks);
    assert(score < 100 && score > 0, `Score should be between 0-100, got ${score}`);
  });

  await test('loadBrain + health on real data', () => {
    if (!existsSync(REAL_BRAIN)) { skipped++; return; }
    const { entities, relations } = loadBrain(REAL_BRAIN);
    const checks = [checkStale(entities), checkDuplicates(entities), checkOrphans(entities, relations)];
    const score = calculateHealth(checks);
    assert(score >= 0 && score <= 100, `Score out of range: ${score}`);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 6. MCP INTEGRATION TESTS
// ══════════════════════════════════════════════════════════════════════════

async function mcpIntegrationTests() {
  console.log('\n🔌 MCP Integration Tests');

  function sendMcp(messages) {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', [join(ROOT, 'scripts', 'hermit-mcp-server.mjs')], {
        cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
        // MCP integration tests exercise advanced tools (consolidate, branch_context,
        // command_list, hook_list) that are gated behind HERMIT_TOOL_PROFILE=full.
        // Force full profile here so tests see the original 34-tool surface.
        env: { ...process.env, MEMORY_FILE_PATH: REAL_BRAIN, HERMIT_TOOL_PROFILE: 'full' },
      });
      let stdout = '';
      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', () => {});
      proc.on('close', () => {
        const responses = stdout.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        resolve(responses);
      });
      proc.on('error', reject);
      setTimeout(() => { proc.stdin.end(); }, 3000);
      proc.stdin.write(messages.map(m => JSON.stringify(m)).join('\n') + '\n');
      setTimeout(() => { proc.stdin.end(); }, 2000);
    });
  }

  await test('MCP: initialize handshake', async () => {
    const responses = await sendMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } } },
    ]);
    const init = responses.find(r => r.id === 1);
    assert(init, 'Should get initialize response');
    assert(init.result.serverInfo.name === 'hermit-graph');
    assert(init.result.serverInfo.version === pkg.version, `Expected ${pkg.version}, got ${init.result.serverInfo.version}`);
  });

  await test('MCP: tools/list returns 34 tools', async () => {
    const responses = await sendMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    const list = responses.find(r => r.id === 2);
    assert(list, 'Should get tools/list response');
    // 30 original + 3 bridge introspection tools + 1 trace tap tool (hermit_tap_traces, Phase 07)
    assert(list.result.tools.length === 34, `Expected 34 tools, got ${list.result.tools.length}`);
  });

  await test('MCP: hermit_search_nodes returns results', async () => {
    if (!existsSync(REAL_BRAIN)) { skipped++; return; }
    const responses = await sendMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hermit_search_nodes', arguments: { query: 'payment' } } },
    ]);
    const result = responses.find(r => r.id === 3);
    assert(result, 'Should get search response');
    assert(!result.result.isError, 'Search should not error');
    assert(result.result.content[0].text.includes('Search:'));
  });

  await test('MCP: hermit_health returns score', async () => {
    if (!existsSync(REAL_BRAIN)) { skipped++; return; }
    const responses = await sendMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'hermit_health', arguments: {} } },
    ]);
    const result = responses.find(r => r.id === 4);
    assert(result, 'Should get health response');
    assert(result.result.content[0].text.includes('Brain Health:'));
  });

  await test('MCP: hermit_branch_context detects branch', async () => {
    const responses = await sendMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'hermit_branch_context', arguments: { action: 'get' } } },
    ]);
    const result = responses.find(r => r.id === 5);
    assert(result, 'Should get branch context response');
    assert(result.result.content[0].text.includes('Current branch:'));
  });

  await test('MCP: hermit_command_list returns commands', async () => {
    const responses = await sendMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'hermit_command_list', arguments: {} } },
    ]);
    const result = responses.find(r => r.id === 7);
    assert(result, 'Should get command_list response');
    assert(!result.result.isError, 'Should not error');
    assert(result.result.content[0].text.includes('Hermit Commands'));
  });

  await test('MCP: hermit_hook_list returns hooks', async () => {
    const responses = await sendMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'hermit_hook_list', arguments: {} } },
    ]);
    const result = responses.find(r => r.id === 8);
    assert(result, 'Should get hook_list response');
    assert(!result.result.isError, 'Should not error');
    assert(result.result.content[0].text.includes('Hermit Hooks'));
  });

  await test('MCP: hermit_consolidate dry run works', async () => {
    if (!existsSync(REAL_BRAIN)) { skipped++; return; }
    const responses = await sendMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'hermit_consolidate', arguments: { dryRun: true } } },
    ]);
    const result = responses.find(r => r.id === 6);
    assert(result, 'Should get consolidate response');
    assert(result.result.content[0].text.includes('Consolidation Report'));
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 7. CODE INTELLIGENCE TESTS
// ══════════════════════════════════════════════════════════════════════════

async function codeIntelTests() {
  console.log('\n🔧 Code Intelligence Tests');
  const { CodeGraph } = await import('./lib/code-intel/graph.mjs');
  const { isSupported } = await import('./lib/code-intel/parser.mjs');

  await test('CodeGraph: add and search symbols', () => {
    const graph = new CodeGraph();
    graph.addSymbols([
      { id: 'test.js::myFunc', kind: 'function', name: 'myFunc', file: 'test.js', line: [1, 10], exported: true, params: 2, lang: 'javascript' },
      { id: 'test.js::helper', kind: 'function', name: 'helper', file: 'test.js', line: [12, 20], exported: false, params: 0, lang: 'javascript' },
    ]);
    const results = graph.searchSymbols('myFunc');
    assert(results.length >= 1, 'Should find myFunc');
    assert(results[0].name === 'myFunc', 'First result should be myFunc');
  });

  await test('CodeGraph: callers and callees', () => {
    const graph = new CodeGraph();
    graph.addSymbols([
      { id: 'a.js::caller', kind: 'function', name: 'caller', file: 'a.js', line: [1, 5], exported: true, params: 0, lang: 'javascript' },
      { id: 'b.js::callee', kind: 'function', name: 'callee', file: 'b.js', line: [1, 5], exported: true, params: 0, lang: 'javascript' },
    ]);
    graph.addRelations([{ from: 'a.js::caller', to: 'b.js::callee', kind: 'CALLS' }]);
    assert(graph.getCallers('b.js::callee').length === 1, 'Should have 1 caller');
    assert(graph.getCallees('a.js::caller').length === 1, 'Should have 1 callee');
  });

  await test('isSupported: recognizes JS/TS files', () => {
    assert(isSupported('test.js'), '.js should be supported');
    assert(isSupported('test.ts'), '.ts should be supported');
    assert(isSupported('test.mjs'), '.mjs should be supported');
    assert(!isSupported('test.rs'), '.rs should not be supported');
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 8. COMMAND EXPORT TESTS
// ══════════════════════════════════════════════════════════════════════════

async function commandExportTests() {
  console.log('\n📦 Command Export Tests');
  const { discoverCommands, exportCommand, exportAllCommands, mergeSingleWrite, resetBackupTracking } = await import('./lib/skill-export.mjs');

  // Setup: fake catalog with test commands
  const fakeCatalog = join(TMP, 'catalog-cmd');
  const cmdDir = join(fakeCatalog, 'catalog', 'commands');
  mkdirSync(cmdDir, { recursive: true });
  writeFileSync(join(cmdDir, 'test-cmd.md'), '---\ndescription: Test command\n---\n# Test Command\nDo the thing.\n');
  writeFileSync(join(cmdDir, 'another-cmd.md'), '# Another\nBody here.\n');

  await test('discoverCommands: finds .md files', () => {
    const cmds = discoverCommands(fakeCatalog);
    assert(cmds.length === 2, `Expected 2, got ${cmds.length}`);
    const names = cmds.map(c => c.name).sort();
    assert(names[0] === 'another-cmd');
    assert(names[1] === 'test-cmd');
  });

  await test('discoverCommands: parses frontmatter', () => {
    const cmds = discoverCommands(fakeCatalog);
    const tc = cmds.find(c => c.name === 'test-cmd');
    assert(tc.fm && tc.fm.description === 'Test command', `Got: ${JSON.stringify(tc.fm)}`);
    assert(tc.body.includes('# Test Command'));
  });

  await test('exportCommand: per-file for claude', () => {
    const projDir = join(TMP, 'proj-cmd-claude');
    mkdirSync(projDir, { recursive: true });
    const result = exportCommand('test-cmd', 'claude', { project: projDir }, fakeCatalog);
    assert(result.action === 'created');
    assert(result.agent === 'claude');
    const written = readFileSync(join(projDir, '.claude', 'commands', 'test-cmd.md'), 'utf-8');
    assert(written.includes('# Test Command'));
  });

  await test('exportCommand: merge-single for gemini uses cmd prefix', () => {
    const projDir = join(TMP, 'proj-cmd-gemini');
    mkdirSync(projDir, { recursive: true });
    const result = exportCommand('test-cmd', 'gemini', { project: projDir }, fakeCatalog);
    assert(result.action === 'created');
    const written = readFileSync(join(projDir, 'GEMINI.md'), 'utf-8');
    assert(written.includes('<!-- hermit:cmd:test-cmd start -->'), 'Should use cmd prefix marker');
    assert(written.includes('<!-- hermit:cmd:test-cmd end -->'));
    assert(written.includes('## /test-cmd'));
  });

  await test('exportAllCommands: exports all commands', () => {
    const projDir = join(TMP, 'proj-cmd-all');
    mkdirSync(projDir, { recursive: true });
    const results = exportAllCommands('claude', { project: projDir }, fakeCatalog);
    assert(results.length === 2, `Expected 2, got ${results.length}`);
    assert(results.every(r => r.action === 'created'));
  });

  await test('mergeSingleWrite: cmd markers independent from skill markers', () => {
    resetBackupTracking();
    const targetPath = join(TMP, 'merge-markers.md');
    // Write a skill section
    mergeSingleWrite(targetPath, '<!-- hermit:skill:foo start -->\nskill body\n<!-- hermit:skill:foo end -->', 'foo', 'skill');
    // Write a cmd section with same item name
    mergeSingleWrite(targetPath, '<!-- hermit:cmd:foo start -->\ncmd body\n<!-- hermit:cmd:foo end -->', 'foo', 'cmd');
    const content = readFileSync(targetPath, 'utf-8');
    assert(content.includes('skill body'), 'Skill section preserved');
    assert(content.includes('cmd body'), 'Cmd section added separately');
    // Should have both markers
    assert(content.includes('hermit:skill:foo'), 'Skill markers exist');
    assert(content.includes('hermit:cmd:foo'), 'Cmd markers exist');
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 9. HOOK EXPORT TESTS
// ══════════════════════════════════════════════════════════════════════════

async function hookExportTests() {
  console.log('\n🪝 Hook Export Tests');
  const { parseHookName, discoverHooks, copyLibDir, exportHook, exportAllHooks } = await import('./lib/hook-export.mjs');

  await test('parseHookName: detects agent suffix', () => {
    const r1 = parseHookName('kg-auto-recall-cursor.cjs');
    assert(r1.purpose === 'kg-auto-recall' && r1.agent === 'cursor', `Got: ${JSON.stringify(r1)}`);
    const r2 = parseHookName('session-hook-gemini.cjs');
    assert(r2.purpose === 'session-hook' && r2.agent === 'gemini');
    const r3 = parseHookName('kg-auto-recall-cline.cjs');
    assert(r3.purpose === 'kg-auto-recall' && r3.agent === 'cline');
  });

  await test('parseHookName: no suffix defaults to claude', () => {
    const r = parseHookName('kg-auto-recall.cjs');
    assert(r.purpose === 'kg-auto-recall' && r.agent === 'claude', `Got: ${JSON.stringify(r)}`);
  });

  // Setup: fake catalog with test hooks + lib
  const fakeCatalog = join(TMP, 'catalog-hook');
  const hooksDir = join(fakeCatalog, 'catalog', 'hooks');
  const libDir = join(hooksDir, 'lib');
  mkdirSync(libDir, { recursive: true });
  writeFileSync(join(hooksDir, 'test-hook.cjs'), '// claude hook');
  writeFileSync(join(hooksDir, 'test-hook-cursor.cjs'), '// cursor hook');
  writeFileSync(join(hooksDir, 'test-hook-gemini.cjs'), '// gemini hook');
  writeFileSync(join(libDir, 'core.cjs'), '// shared lib');

  await test('discoverHooks: finds .cjs files + parses agents', () => {
    const hooks = discoverHooks(fakeCatalog);
    assert(hooks.length === 3, `Expected 3, got ${hooks.length}`);
    const agents = hooks.map(h => h.agent).sort();
    assert(agents.includes('claude'));
    assert(agents.includes('cursor'));
    assert(agents.includes('gemini'));
    assert(hooks.every(h => h.hasLib), 'All should detect lib/');
  });

  await test('copyLibDir: copies .cjs files', () => {
    const dstLib = join(TMP, 'lib-copy-test');
    copyLibDir(libDir, dstLib);
    assert(existsSync(join(dstLib, 'core.cjs')));
    const content = readFileSync(join(dstLib, 'core.cjs'), 'utf-8');
    assert(content === '// shared lib');
  });

  await test('exportHook: copies hook + lib', () => {
    const projDir = join(TMP, 'proj-hook-claude');
    mkdirSync(projDir, { recursive: true });
    const result = exportHook('test-hook.cjs', 'claude', { project: projDir }, fakeCatalog);
    assert(result.action === 'created');
    assert(existsSync(join(projDir, '.claude', 'hooks', 'test-hook.cjs')));
    assert(existsSync(join(projDir, '.claude', 'hooks', 'lib', 'core.cjs')));
  });

  await test('exportAllHooks: filters by agent', () => {
    const projDir = join(TMP, 'proj-hook-cursor');
    mkdirSync(projDir, { recursive: true });
    const results = exportAllHooks('cursor', { project: projDir }, fakeCatalog);
    assert(results.length === 1, `Expected 1 cursor hook, got ${results.length}`);
    assert(results[0].name === 'test-hook-cursor.cjs');
    assert(existsSync(join(projDir, '.cursor', 'hooks', 'test-hook-cursor.cjs')));
    assert(existsSync(join(projDir, '.cursor', 'hooks', 'lib', 'core.cjs')));
  });

  await test('exportAllHooks: returns empty for agent with no hooks', () => {
    const results = exportAllHooks('codex', {}, fakeCatalog);
    assert(results.length === 0, `Expected 0, got ${results.length}`);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 10. SKILL INDEX + SEARCH TESTS
// ══════════════════════════════════════════════════════════════════════════

async function skillIndexTests() {
  console.log('\n🔍 Skill Index + Search Tests');
  const { buildSkillIndex, getSkillIndex, invalidateSkillIndex } = await import('./lib/skill-index.mjs');
  const { searchSkills } = await import('./lib/skill-search-module.mjs');

  await test('buildSkillIndex: returns Map with catalog skills', () => {
    const index = buildSkillIndex();
    assert(index instanceof Map, 'Should return a Map');
    assert(index.size > 0, `Expected >0 skills, got ${index.size}`);
  });

  await test('buildSkillIndex: each entry has required SkillMeta fields', () => {
    const index = buildSkillIndex();
    const first = index.values().next().value;
    assert(typeof first.name === 'string' && first.name.length > 0, 'name required');
    assert(typeof first.description === 'string', 'description required');
    assert(Array.isArray(first.tags), 'tags must be array');
    assert(Array.isArray(first.paths), 'paths must be array');
    assert(['catalog', 'project'].includes(first.source), `Invalid source: ${first.source}`);
    assert(typeof first.filePath === 'string', 'filePath required');
  });

  await test('getSkillIndex: caching returns same reference', () => {
    invalidateSkillIndex();
    const a = getSkillIndex();
    const b = getSkillIndex();
    assert(a === b, 'Second call should return cached reference');
    invalidateSkillIndex(); // cleanup
  });

  await test('invalidateSkillIndex: clears cache', () => {
    const a = getSkillIndex();
    invalidateSkillIndex();
    const b = getSkillIndex();
    assert(a !== b, 'After invalidate, should build new index');
    invalidateSkillIndex(); // cleanup
  });

  await test('searchSkills: finds payment-integration skill', () => {
    invalidateSkillIndex();
    const results = searchSkills('payment integration');
    assert(results.length > 0, 'Should find at least 1 result');
    assert(results[0].name === 'payment-integration', `Expected payment-integration, got ${results[0].name}`);
  });

  await test('searchSkills: scores are normalized 0-1', () => {
    invalidateSkillIndex();
    const results = searchSkills('payment');
    for (const r of results) {
      assert(r.score >= 0 && r.score <= 1, `Score ${r.score} out of range for ${r.name}`);
    }
  });

  await test('searchSkills: gibberish returns empty', () => {
    const results = searchSkills('xyzzyplugh99');
    assert(results.length === 0, `Expected 0 results, got ${results.length}`);
  });

  await test('searchSkills: respects limit parameter', () => {
    const results = searchSkills('code', { limit: 2 });
    assert(results.length <= 2, `Expected <=2 results, got ${results.length}`);
  });

  await test('searchSkills: source filter works', () => {
    const results = searchSkills('code', { source: 'catalog', minScore: 0.01 });
    for (const r of results) {
      assert(r.source === 'catalog', `Expected catalog source, got ${r.source}`);
    }
  });

  await test('searchSkills: results have activationHint', () => {
    const results = searchSkills('git');
    assert(results.length > 0, 'Should find git-related skills');
    for (const r of results) {
      assert(typeof r.activationHint === 'string' && r.activationHint.includes('SKILL.md'),
        `Missing activationHint for ${r.name}`);
    }
  });

  await test('searchSkills: results sorted by descending score', () => {
    const results = searchSkills('web design');
    for (let i = 1; i < results.length; i++) {
      assert(results[i - 1].score >= results[i].score,
        `Score order wrong: ${results[i - 1].score} < ${results[i].score}`);
    }
  });

  invalidateSkillIndex(); // final cleanup
}

// ══════════════════════════════════════════════════════════════════════════
// 11. RECALL-CORE: TOKEN BUDGET + TASK DETECTION TESTS (Phase 2 + 5)
// ══════════════════════════════════════════════════════════════════════════

async function recallCoreTests() {
  console.log('\n🧠 Recall Core: Token Budget + Task Detection Tests');

  // CJS dynamic import needs createRequire
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const core = require('../catalog/hooks/lib/recall-core.cjs');

  // ── Phase 2: Token estimation ──

  await test('estimateChars: compact < standard < full', () => {
    const fakeResults = [
      { name: 'TECH:Foo', entityType: 'tech-stack', observations: ['obs1 long text here', 'obs2 more text', 'obs3 extra'] },
      { name: 'BIZ:Bar', entityType: 'biz-domain', observations: ['obs-a detailed observation', 'obs-b second one'] },
    ];
    const compact = core.estimateChars(fakeResults, 'compact');
    const standard = core.estimateChars(fakeResults, 'standard');
    const full = core.estimateChars(fakeResults, 'full');
    assert(compact < standard, `compact (${compact}) should be < standard (${standard})`);
    assert(standard < full, `standard (${standard}) should be < full (${full})`);
  });

  await test('selectDetailLevel: returns full for small result set', () => {
    const small = [
      { name: 'E1', entityType: 'tech-stack', observations: ['short obs'] },
    ];
    assert(core.selectDetailLevel(small) === 'full', 'Small set should be full');
  });

  await test('selectDetailLevel: downgrades with low cap override', () => {
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push({
        name: `TECH:Entity${i}`,
        entityType: 'tech-stack',
        observations: ['A'.repeat(200), 'B'.repeat(200), 'C'.repeat(200)],
      });
    }
    const level = core.selectDetailLevel(results, 500); // very low cap
    assert(level === 'compact', `Expected compact with cap=500, got ${level}`);
  });

  await test('formatResults: detailLevel=compact omits observations', () => {
    const results = [
      { name: 'TECH:X', entityType: 'tech-stack', observations: ['hidden obs'], score: 5, matchedKeywords: ['x'] },
    ];
    const output = core.formatResults(results, ['x'], [], 'compact');
    assert(output.includes('### TECH:X'), 'Should include entity name');
    assert(!output.includes('hidden obs'), 'Compact should not include observations');
  });

  await test('formatResults: detailLevel=standard shows 1 observation', () => {
    const results = [
      { name: 'TECH:Y', entityType: 'tech-stack', observations: ['first obs', 'second obs', 'third obs'], score: 5, matchedKeywords: ['y'] },
    ];
    const output = core.formatResults(results, ['y'], [], 'standard');
    assert(output.includes('first obs'), 'Standard should include first obs');
    assert(!output.includes('second obs'), 'Standard should not include second obs');
  });

  await test('formatResults: null detailLevel auto-detects', () => {
    const results = [
      { name: 'E1', entityType: 'tech-stack', observations: ['obs1'] },
    ];
    const output = core.formatResults(results, ['test'], []);
    assert(output !== null, 'Should produce output');
    assert(output.includes('obs1'), 'Auto-detect should be full for small set');
  });

  // ── Phase 5: Prompt type detection ──

  await test('detectPromptType: task prompt with 2+ signals', () => {
    const taskPrompt = 'Task: Fix parser bug\nFiles to modify: src/parser.ts\nAcceptance criteria: tests pass';
    assert(core.detectPromptType(taskPrompt) === 'task', 'Should detect as task');
  });

  await test('detectPromptType: conversational prompt', () => {
    assert(core.detectPromptType('help me fix the parser bug') === 'conversational');
  });

  await test('detectPromptType: single signal = conversational (not task)', () => {
    assert(core.detectPromptType('Task: something simple') === 'conversational',
      'Single signal should not trigger task detection');
  });

  await test('extractTaskKeywords: extracts file paths', () => {
    const prompt = 'Task: Fix bug\nFiles to modify: src/lib/recall-core.cjs\nAcceptance criteria: done';
    const kw = core.extractTaskKeywords(prompt);
    assert(kw.some(k => k.includes('recall')), `Should extract recall from file path, got: ${kw.join(', ')}`);
  });

  await test('extractTaskKeywords: extracts entity refs', () => {
    const prompt = 'Task: Update TECH:OpenCode config\nFiles to modify: config.ts\nWork context: /project';
    const kw = core.extractTaskKeywords(prompt);
    assert(kw.some(k => k.includes('tech:opencode')), `Should extract entity ref, got: ${kw.join(', ')}`);
  });

  await test('extractTaskKeywords: extracts backtick terms', () => {
    const prompt = 'Task: Fix `hermit_skill_search` tool\nFiles to modify: skill-search-module.mjs\nWork context: /x';
    const kw = core.extractTaskKeywords(prompt);
    assert(kw.some(k => k.includes('hermit_skill_search')), `Should extract backtick term, got: ${kw.join(', ')}`);
  });

  await test('expandRelations: returns empty on missing brain', () => {
    const result = core.expandRelations([{ name: 'E1' }], '/nonexistent/path.jsonl');
    assert(result.length === 0, 'Should return empty for missing brain');
  });

  await test('expandRelations: finds related entities from real brain', () => {
    if (!existsSync(REAL_BRAIN)) { skipped++; return; }
    // Use a known entity that has relations
    const results = [{ name: 'BIZ:ClaudeCodeBrain' }];
    const expanded = core.expandRelations(results, REAL_BRAIN);
    assert(expanded.length > 0, `Should find related entities, got ${expanded.length}`);
    assert(expanded.length <= core.MAX_EXPANSION, `Should cap at ${core.MAX_EXPANSION}`);
  });

  // ── High-level recall() ──

  await test('recall: returns null for empty prompt', () => {
    assert(core.recall('') === null, 'Empty prompt should return null');
  });

  await test('recall: returns output for keyword-rich prompt', () => {
    if (!existsSync(REAL_BRAIN)) { skipped++; return; }
    const output = core.recall('tell me about opencode skill portability');
    // May or may not find results depending on KG content, but should not throw
    assert(output === null || typeof output === 'string', 'Should return string or null');
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 12. Entity Extractor Tests (Phase 4)
// ══════════════════════════════════════════════════════════════════════════

async function entityExtractorTests() {
  console.log('\n🔬 Entity Extractor Tests');

  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const ext = require(join(ROOT, 'catalog', 'hooks', 'lib', 'entity-extractor.cjs'));

  // ── Individual extractors ──

  await test('extractExplicitEntities: finds backtick-quoted entities', () => {
    const text = 'We use `TECH:Decision:PostgreSQL` and `PATTERN:JWTAuth` for this.';
    const results = ext.extractExplicitEntities(text);
    assert(results.length === 2, `Expected 2, got ${results.length}`);
    assert(results[0].raw === 'TECH:Decision:PostgreSQL', `Got: ${results[0].raw}`);
    assert(results[1].raw === 'PATTERN:JWTAuth', `Got: ${results[1].raw}`);
    assert(results[0].type === 'explicit', 'Type should be explicit');
  });

  await test('extractTechDecisions: finds "chose X" patterns', () => {
    const text = 'We chose PostgreSQL for the database. Later we switched to Redis for caching.';
    const results = ext.extractTechDecisions(text);
    assert(results.length >= 1, `Expected at least 1, got ${results.length}`);
    assert(results.some(r => r.raw === 'PostgreSQL'), 'Should find PostgreSQL');
  });

  await test('extractTechDecisions: skips noise words', () => {
    const text = 'We use The Thing and prefer This approach.';
    const results = ext.extractTechDecisions(text);
    const noNoiseWords = results.every(r => r.raw !== 'The' && r.raw !== 'This');
    assert(noNoiseWords, 'Should not extract noise words');
  });

  await test('extractErrorPatterns: finds error descriptions', () => {
    const text = 'error: Connection timeout after 30 seconds while connecting to the database.\nAnother bug: Memory leak in the event handler module detected.';
    const results = ext.extractErrorPatterns(text);
    assert(results.length >= 1, `Expected at least 1, got ${results.length}`);
    assert(results[0].type === 'error-pattern', 'Type should be error-pattern');
  });

  await test('extractPascalCase: finds multi-hump identifiers', () => {
    const text = 'The UserService calls PaymentGateway which returns OrderResponse.';
    const results = ext.extractPascalCase(text);
    assert(results.length === 3, `Expected 3, got ${results.length}`);
    const names = results.map(r => r.raw);
    assert(names.includes('UserService'), 'Should find UserService');
    assert(names.includes('PaymentGateway'), 'Should find PaymentGateway');
    assert(names.includes('OrderResponse'), 'Should find OrderResponse');
  });

  await test('extractAllCaps: finds config constants', () => {
    const text = 'Set DATABASE_URL and REDIS_HOST in your .env file.';
    const results = ext.extractAllCaps(text);
    assert(results.length === 2, `Expected 2, got ${results.length}`);
    const names = results.map(r => r.raw);
    assert(names.includes('DATABASE_URL'), 'Should find DATABASE_URL');
    assert(names.includes('REDIS_HOST'), 'Should find REDIS_HOST');
  });

  await test('extractAllCaps: filters noise words', () => {
    const text = 'Check the TODO and NOTE items. Also HTTP and JSON are fine.';
    const results = ext.extractAllCaps(text);
    assert(results.length === 0, `Expected 0 (all noise), got ${results.length}`);
  });

  // ── Classification ──

  await test('classify: explicit entity preserves name', () => {
    const result = ext.classify({ raw: 'TECH:Decision:Redis', type: 'explicit' }, 'MyProject');
    assert(result.name === 'TECH:Decision:Redis', `Got: ${result.name}`);
    assert(result.entityType === 'tech-decision', `Got: ${result.entityType}`);
  });

  await test('classify: tech-decision creates TECH:Decision name', () => {
    const result = ext.classify({ raw: 'PostgreSQL', type: 'tech-decision' }, 'MyProject');
    assert(result.name === 'TECH:Decision:PostgreSQL', `Got: ${result.name}`);
    assert(result.entityType === 'tech-decision', `Got: ${result.entityType}`);
  });

  await test('classify: error-pattern creates INCIDENT name', () => {
    const result = ext.classify({ raw: 'Connection timeout after 30s', type: 'error-pattern' }, 'TestProj');
    assert(result.name.startsWith('INCIDENT:TestProj:'), `Got: ${result.name}`);
    assert(result.entityType === 'incident-bug', `Got: ${result.entityType}`);
  });

  // ── Full pipeline ──

  await test('extractEntities: full pipeline with mixed content', () => {
    const text = `
      We chose PostgreSQL for the database and adopted Redis for caching.
      Found a bug: Connection timeout after 30 seconds on the auth server.
      Also referenced \`TECH:Decision:TypeScript\` in the conversation.
    `;
    const entities = ext.extractEntities(text, 'TestProject');
    assert(entities.length >= 2, `Expected at least 2, got ${entities.length}`);
    const names = entities.map(e => e.name);
    assert(names.some(n => n.includes('PostgreSQL')), 'Should have PostgreSQL entity');
    assert(names.includes('TECH:Decision:TypeScript'), 'Should have explicit TypeScript entity');
  });

  await test('extractEntities: frequency filter for PascalCase', () => {
    // UserService mentioned only once — should NOT be extracted
    const text = 'The UserService handles auth. We chose PostgreSQL.';
    const entities = ext.extractEntities(text, 'Test');
    const hasSinglePascal = entities.some(e => e.name.includes('UserService'));
    assert(!hasSinglePascal, 'Single-mention PascalCase should be filtered');
  });

  await test('extractEntities: frequency filter passes 3+ mentions', () => {
    const text = 'UserService handles login. UserService validates tokens. UserService logs activity.';
    const entities = ext.extractEntities(text, 'Test');
    const hasPascal = entities.some(e => e.name.includes('UserService'));
    assert(hasPascal, '3+ mention PascalCase should pass frequency filter');
  });

  await test('extractEntities: caps at MAX_ENTITIES', () => {
    // Generate text with 15+ explicit entities
    const refs = Array.from({length: 15}, (_, i) => `\`TECH:Decision:Tool${i}\``).join(' and ');
    const entities = ext.extractEntities(refs, 'Test');
    assert(entities.length <= ext.MAX_ENTITIES, `Should cap at ${ext.MAX_ENTITIES}, got ${entities.length}`);
  });

  await test('extractEntities: empty text returns empty', () => {
    assert(ext.extractEntities('', 'Test').length === 0, 'Empty text');
    assert(ext.extractEntities('short', 'Test').length === 0, 'Too short');
  });

  // ── Deduplication ──

  await test('filterExisting: removes known entities', () => {
    const tmpBrain = join(TMP, 'filter-test-brain.jsonl');
    writeFileSync(tmpBrain, JSON.stringify({
      type: 'entity', name: 'TECH:Decision:PostgreSQL', entityType: 'tech-decision',
      observations: [], createdAt: Date.now()
    }) + '\n');

    const entities = [
      { name: 'TECH:Decision:PostgreSQL', entityType: 'tech-decision', observations: ['dup'] },
      { name: 'TECH:Decision:Redis', entityType: 'tech-decision', observations: ['new'] },
    ];
    const filtered = ext.filterExisting(entities, tmpBrain);
    assert(filtered.length === 1, `Expected 1, got ${filtered.length}`);
    assert(filtered[0].name === 'TECH:Decision:Redis', `Got: ${filtered[0].name}`);
  });

  await test('filterExisting: case-insensitive match', () => {
    const tmpBrain = join(TMP, 'filter-case-brain.jsonl');
    writeFileSync(tmpBrain, JSON.stringify({
      type: 'entity', name: 'tech:decision:postgresql', entityType: 'tech-decision',
      observations: [], createdAt: Date.now()
    }) + '\n');

    const entities = [
      { name: 'TECH:Decision:PostgreSQL', entityType: 'tech-decision', observations: ['test'] },
    ];
    const filtered = ext.filterExisting(entities, tmpBrain);
    assert(filtered.length === 0, 'Case-insensitive match should filter');
  });

  // ── appendToBrain ──

  await test('appendToBrain: writes entities to brain file', () => {
    const tmpBrain = join(TMP, 'append-test-brain.jsonl');
    const entities = [
      { name: 'TECH:Decision:Redis', entityType: 'tech-decision', observations: ['Chose Redis for caching'] },
    ];
    const written = ext.appendToBrain(entities, tmpBrain);
    assert(written === 1, `Expected 1, got ${written}`);
    assert(existsSync(tmpBrain), 'Brain file should exist');

    const content = readFileSync(tmpBrain, 'utf-8').trim();
    const obj = JSON.parse(content);
    assert(obj.type === 'entity', 'Should be entity type');
    assert(obj.name === 'TECH:Decision:Redis', `Got: ${obj.name}`);
    assert(obj.observations[0].content.includes('[0.5|'), 'Should have auto confidence prefix');
    assert(obj.observations[0].confidence === 0.5, 'Confidence should be 0.5');
  });

  await test('formatObservations: adds confidence prefix', () => {
    const obs = ext.formatObservations(['test observation']);
    assert(obs.length === 1, 'Should return 1 observation');
    assert(obs[0].content.startsWith('[0.5|'), `Got: ${obs[0].content}`);
    assert(obs[0].content.includes('test observation'), 'Should include original text');
    assert(obs[0].confidence === 0.5, `Got: ${obs[0].confidence}`);
  });

  // ── guessEntityType ──

  await test('guessEntityType: maps tiers correctly', () => {
    assert(ext.guessEntityType('BIZ:Proj:X') === 'biz-domain', 'BIZ → biz-domain');
    assert(ext.guessEntityType('RULE:X:Y') === 'biz-rule', 'RULE → biz-rule');
    assert(ext.guessEntityType('PATTERN:X') === 'pattern-code', 'PATTERN → pattern-code');
    assert(ext.guessEntityType('INCIDENT:X:Y') === 'incident-bug', 'INCIDENT → incident-bug');
    assert(ext.guessEntityType('GOTCHA:X') === 'incident-gotcha', 'GOTCHA → incident-gotcha');
    assert(ext.guessEntityType('UNKNOWN:X') === 'tech-stack', 'Unknown → tech-stack fallback');
  });
}

// ══════════════════════════════════════════════════════════════════════════
// ── Frontmatter Parser Tests ──────────────────────────────────────────────

async function frontmatterTests() {
  console.log('\n── Frontmatter Parser ──');
  const { parseFrontmatter } = await import('../scripts/lib/skill-adapters.mjs');

  await test('parseFrontmatter handles flat key:value', () => {
    const { fm, body } = parseFrontmatter('---\nname: test\ndescription: hello world\n---\nbody content');
    if (!fm) throw new Error('fm should not be null');
    if (fm.name !== 'test') throw new Error(`expected "test", got "${fm.name}"`);
    if (fm.description !== 'hello world') throw new Error(`expected "hello world", got "${fm.description}"`);
    if (body !== 'body content') throw new Error(`unexpected body: "${body}"`);
  });

  await test('parseFrontmatter handles YAML lists', () => {
    const input = '---\nname: test\npaths:\n  - data/brain.jsonl\n  - BUSINESS.md\ntags: memory\n---\nbody';
    const { fm } = parseFrontmatter(input);
    if (!fm) throw new Error('fm should not be null');
    if (!Array.isArray(fm.paths)) throw new Error('paths should be array');
    if (fm.paths.length !== 2) throw new Error(`expected 2 paths, got ${fm.paths.length}`);
    if (fm.paths[0] !== 'data/brain.jsonl') throw new Error(`unexpected path[0]: "${fm.paths[0]}"`);
    if (fm.paths[1] !== 'BUSINESS.md') throw new Error(`unexpected path[1]: "${fm.paths[1]}"`);
    if (fm.tags !== 'memory') throw new Error('flat value after list should work');
  });

  await test('parseFrontmatter strips quotes from list items', () => {
    const input = '---\npaths:\n  - "src/**/*.ts"\n  - \'lib/*.js\'\n---\nbody';
    const { fm } = parseFrontmatter(input);
    if (!Array.isArray(fm.paths)) throw new Error('paths should be array');
    if (fm.paths[0] !== 'src/**/*.ts') throw new Error(`quotes not stripped: "${fm.paths[0]}"`);
    if (fm.paths[1] !== 'lib/*.js') throw new Error(`quotes not stripped: "${fm.paths[1]}"`);
  });
}

async function resolutionTests() {
  console.log('\n🧭 Multi-Strategy Resolution Tests (Phase 03)');
  const res = await import('../scripts/lib/code-intel/resolution/index.mjs');
  const { CodeGraph } = await import('../scripts/lib/code-intel/graph.mjs');
  const { scoreCandidate, pickBest } = await import('../scripts/lib/code-intel/resolution/scoring.mjs');

  // Fixture: 3 symbols across 2 files, one with parent class.
  function fixture() {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 's1', name: 'fooBar', kind: 'function', file: 'src/util.ts', line: [10, 20], lang: 'typescript', exported: true },
      { id: 's2', name: 'fooBar', kind: 'method',   file: 'src/other.ts', line: [30, 40], lang: 'typescript', parent: 'OtherClass' },
      { id: 's3', name: 'baz',    kind: 'function', file: 'src/util.ts', line: [50, 60], lang: 'typescript' },
    ]);
    return g;
  }

  await test('scoring: same-file beats cross-file', () => {
    const g = fixture();
    const ref = { referenceKind: 'calls', fromFile: 'src/util.ts', fromLang: 'typescript' };
    const sameFile = scoreCandidate(ref, g.symbols.get('s1'));
    const crossFile = scoreCandidate(ref, g.symbols.get('s2'));
    assert(sameFile > crossFile, `same-file (${sameFile}) should beat cross-file (${crossFile})`);
  });

  await test('scoring: cross-language penalty applies', () => {
    const ref = { referenceKind: 'calls', fromFile: 'a.ts', fromLang: 'typescript' };
    const tsTarget = { id: 'x', name: 'y', kind: 'function', file: 'b.ts', lang: 'typescript' };
    const pyTarget = { id: 'x', name: 'y', kind: 'function', file: 'b.py', lang: 'python' };
    const tsScore = scoreCandidate(ref, tsTarget);
    const pyScore = scoreCandidate(ref, pyTarget);
    assert(tsScore - pyScore >= 100, `cross-language penalty too weak: ts=${tsScore} py=${pyScore}`);
  });

  await test('pickBest: returns ambiguous when scores tie', () => {
    const ref = { referenceKind: 'calls', fromFile: 'src/somewhere-else.ts', fromLang: 'typescript' };
    const candidates = [
      { id: 'a', name: 'fooBar', kind: 'function', file: 'src/util.ts', lang: 'typescript' },
      { id: 'b', name: 'fooBar', kind: 'function', file: 'src/other.ts', lang: 'typescript' },
    ];
    const r = pickBest(ref, candidates);
    assert(r.ambiguous, 'should be ambiguous');
    assert(r.alternatives.length === 1, `expected 1 alt, got ${r.alternatives.length}`);
  });

  await test('resolveReference: unknown name returns null', () => {
    const g = fixture();
    const r = res.resolveReference(
      { sourceId: 'x', referenceName: 'doesNotExist', referenceKind: 'calls', fromFile: 'src/util.ts', fromLang: 'typescript' },
      { graph: g, knownNames: res.buildKnownNames(g) }
    );
    assert(r === null, `expected null, got ${JSON.stringify(r)}`);
  });

  await test('resolveReference: same-file gets confidence 1.0 via name strategy', () => {
    const g = fixture();
    const r = res.resolveReference(
      { sourceId: 'x', referenceName: 'fooBar', referenceKind: 'calls', fromFile: 'src/util.ts', fromLine: 5, fromLang: 'typescript' },
      { graph: g, knownNames: res.buildKnownNames(g) }
    );
    assert(r, 'should resolve');
    assert(r.targetId === 's1', `expected s1, got ${r.targetId}`);
    assert(r.confidence >= 0.9, `confidence too low: ${r.confidence}`);
    assert(r.resolvedBy === 'name', `unexpected provenance: ${r.resolvedBy}`);
  });

  await test('resolveReference: ambiguous returns alternatives', () => {
    const g = fixture();
    const r = res.resolveReference(
      { sourceId: 'x', referenceName: 'fooBar', referenceKind: 'calls', fromFile: 'src/somewhere-else.ts', fromLang: 'typescript' },
      { graph: g, knownNames: res.buildKnownNames(g) }
    );
    assert(r, 'should resolve');
    assert(r.resolvedBy === 'name:fuzzy', `expected fuzzy, got ${r.resolvedBy}`);
    assert(Array.isArray(r.alternatives) && r.alternatives.length === 1, `expected 1 alt, got ${r.alternatives?.length}`);
  });

  await test('resolveReference: ClassName.methodName form picks scoped target', () => {
    const g = fixture();
    const r = res.resolveReference(
      { sourceId: 'x', referenceName: 'OtherClass.fooBar', referenceKind: 'calls', fromFile: 'src/util.ts', fromLang: 'typescript' },
      { graph: g, knownNames: res.buildKnownNames(g) }
    );
    assert(r, 'should resolve');
    assert(r.targetId === 's2', `expected s2, got ${r.targetId}`);
  });

  await test('framework strategy short-circuits at confidence >= 0.9', () => {
    const g = fixture();
    res.clearFrameworks();
    res.registerFramework({
      name: 'fake-fw',
      resolve: (ref) => ({ sourceId: ref.sourceId, targetId: 's3', kind: 'calls', confidence: 0.95 }),
    });
    const r = res.resolveReference(
      { sourceId: 'x', referenceName: 'fooBar', referenceKind: 'calls', fromFile: 'src/util.ts', fromLang: 'typescript' },
      { graph: g, knownNames: res.buildKnownNames(g), activeFrameworks: ['fake-fw'] }
    );
    res.clearFrameworks();
    assert(r, 'should resolve via framework');
    assert(r.resolvedBy === 'framework:fake-fw', `expected framework provenance, got ${r.resolvedBy}`);
    assert(r.targetId === 's3', `framework target wrong: ${r.targetId}`);
  });

  await test('framework strategy below 0.9 falls through to name', () => {
    const g = fixture();
    res.clearFrameworks();
    res.registerFramework({
      name: 'weak-fw',
      resolve: (ref) => ({ sourceId: ref.sourceId, targetId: 's3', kind: 'calls', confidence: 0.6 }),
    });
    const r = res.resolveReference(
      { sourceId: 'x', referenceName: 'fooBar', referenceKind: 'calls', fromFile: 'src/util.ts', fromLine: 5, fromLang: 'typescript' },
      { graph: g, knownNames: res.buildKnownNames(g), activeFrameworks: ['weak-fw'] }
    );
    res.clearFrameworks();
    assert(r, 'should resolve');
    // Same-file name match scores higher (conf 1.0) than weak framework (0.6).
    assert(r.confidence === 1, `expected name win at conf 1.0, got ${r.confidence} via ${r.resolvedBy}`);
  });

  await test('resolveBatch: filters unresolved refs', () => {
    const g = fixture();
    const batch = res.resolveBatch(
      [
        { sourceId: 'x', referenceName: 'baz',  referenceKind: 'calls', fromFile: 'src/util.ts', fromLang: 'typescript' },
        { sourceId: 'y', referenceName: 'nope', referenceKind: 'calls', fromFile: 'src/util.ts', fromLang: 'typescript' },
      ],
      { graph: g }
    );
    assert(batch.length === 1, `expected 1 resolved, got ${batch.length}`);
    assert(batch[0].targetId === 's3', `unexpected target: ${batch[0].targetId}`);
  });

  await test('known-names: indexes Class.method qualified form', () => {
    const g = fixture();
    const names = res.buildKnownNames(g);
    assert(res.isKnownName(names, 'OtherClass.fooBar'), 'qualified form should be indexed');
    assert(res.isKnownName(names, 'fooBar'), 'plain name should be indexed');
    assert(!res.isKnownName(names, 'NoSuchSym'), 'unknown should be rejected');
  });
}

async function frameworkResolverTests() {
  console.log('\n🛣️  Framework Resolver Tests (Phase 04)');
  const res = await import('../scripts/lib/code-intel/resolution/index.mjs');
  const { expressResolver } = await import('../scripts/lib/code-intel/resolution/frameworks/express.mjs');
  const { CodeGraph } = await import('../scripts/lib/code-intel/graph.mjs');

  function fixture() {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'h1', name: 'getUser',         kind: 'function', file: 'src/handlers/user.ts',     line: [10, 20], lang: 'typescript', exported: true },
      { id: 'h2', name: 'checkoutHandler', kind: 'function', file: 'src/handlers/checkout.ts', line: [5, 30],  lang: 'typescript', exported: true },
      { id: 'r1', name: 'app',             kind: 'variable', file: 'src/server.ts',            line: [3, 3],   lang: 'typescript' },
    ]);
    return g;
  }

  await test('express resolver: handler reference resolves via regex', () => {
    const g = fixture();
    const r = expressResolver.resolve(
      {
        sourceId: 'r1',
        referenceName: 'getUser',
        referenceKind: 'calls',
        fromFile: 'src/server.ts',
        fromLang: 'typescript',
        contextText: "app.get('/users/:id', getUser)",
      },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'h1', `expected h1, got ${r.targetId}`);
    assert(r.confidence === 0.85, `expected 0.85, got ${r.confidence}`);
  });

  await test('express resolver: router.METHOD also matches', () => {
    const g = fixture();
    const r = expressResolver.resolve(
      {
        sourceId: 'r1',
        referenceName: 'checkoutHandler',
        referenceKind: 'calls',
        fromFile: 'src/server.ts',
        fromLang: 'typescript',
        contextText: "router.post('/checkout', checkoutHandler)",
      },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'h2', `expected h2, got ${r.targetId}`);
  });

  await test('express resolver: returns null without contextText', () => {
    const g = fixture();
    const r = expressResolver.resolve(
      { sourceId: 'r1', referenceName: 'getUser', referenceKind: 'calls' },
      { graph: g }
    );
    assert(r === null, `expected null, got ${JSON.stringify(r)}`);
  });

  await test('express resolver: returns null for non-calls kind', () => {
    const g = fixture();
    const r = expressResolver.resolve(
      {
        sourceId: 'r1', referenceName: 'getUser', referenceKind: 'imports',
        contextText: "app.get('/users/:id', getUser)",
      },
      { graph: g }
    );
    assert(r === null, `expected null for non-calls, got ${JSON.stringify(r)}`);
  });

  await test('express resolver registered → cascade wins via framework', () => {
    const g = fixture();
    res.clearFrameworks();
    res.registerFramework({
      name: 'express',
      resolve: (ref, ctx) => {
        const r = expressResolver.resolve(ref, ctx);
        if (!r) return null;
        // Bump to high-confidence so cascade short-circuits to framework.
        return { ...r, confidence: 0.92 };
      },
    });
    const result = res.resolveReference(
      {
        sourceId: 'r1',
        referenceName: 'getUser',
        referenceKind: 'calls',
        fromFile: 'src/server.ts',
        fromLang: 'typescript',
        contextText: "app.get('/users/:id', getUser)",
      },
      { graph: g, knownNames: res.buildKnownNames(g), activeFrameworks: ['express'] }
    );
    res.clearFrameworks();
    assert(result, 'cascade should resolve');
    assert(result.resolvedBy === 'framework:express', `expected framework provenance, got ${result.resolvedBy}`);
    assert(result.targetId === 'h1', `target wrong: ${result.targetId}`);
  });

  await test('express resolver: handler not in graph → null', () => {
    const g = fixture();
    const r = expressResolver.resolve(
      {
        sourceId: 'r1',
        referenceName: 'orphanHandler',
        referenceKind: 'calls',
        contextText: "app.delete('/x', orphanHandler)",
      },
      { graph: g }
    );
    assert(r === null, `expected null when handler absent, got ${JSON.stringify(r)}`);
  });
}

async function scanSourceTests() {
  console.log('\n🔭 scanSource Live-Pipeline Tests (Phase 03 wave 2)');
  const { expressResolver } = await import('../scripts/lib/code-intel/resolution/frameworks/express.mjs');
  const { laravelResolver } = await import('../scripts/lib/code-intel/resolution/frameworks/laravel.mjs');
  const { nestjsResolver }  = await import('../scripts/lib/code-intel/resolution/frameworks/nestjs.mjs');
  const { vueResolver }     = await import('../scripts/lib/code-intel/resolution/frameworks/vue.mjs');
  const { djangoResolver }  = await import('../scripts/lib/code-intel/resolution/frameworks/django.mjs');
  const { railsResolver }   = await import('../scripts/lib/code-intel/resolution/frameworks/rails.mjs');
  const { CodeGraph } = await import('../scripts/lib/code-intel/graph.mjs');

  await test('express scanSource: emits CALLS for app.get(handler)', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'h', name: 'getUser', kind: 'function', file: 'src/server.ts', line: [50, 60], lang: 'typescript' },
    ]);
    const src = "import express from 'express';\nconst app = express();\napp.get('/users/:id', getUser);\n";
    const rels = expressResolver.scanSource(src, 'src/server.ts', g);
    assert(rels.length === 1, `expected 1 relation, got ${rels.length}`);
    assert(rels[0].kind === 'CALLS');
    assert(rels[0].to === 'h');
    assert(rels[0]._meta.resolvedBy === 'framework:express');
  });

  await test('laravel scanSource: emits CALLS for [Ctrl::class, method]', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'm', name: 'store', kind: 'method', file: 'app/Http/Controllers/CheckoutController.php', line: [10, 20], lang: 'php', parent: 'CheckoutController' },
    ]);
    const src = "Route::post('/checkout', [CheckoutController::class, 'store']);";
    const rels = laravelResolver.scanSource(src, 'routes/web.php', g);
    assert(rels.length === 1);
    assert(rels[0].to === 'm');
  });

  await test('nestjs scanSource: emits CALLS for @Inject(TOKEN)', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 't', name: 'USER_REPO', kind: 'constant', file: 'src/tokens.ts', line: [3, 3], lang: 'typescript' },
    ]);
    const src = "@Injectable()\nclass UserService {\n  constructor(@Inject(USER_REPO) repo) {}\n}";
    const rels = nestjsResolver.scanSource(src, 'src/user.service.ts', g);
    assert(rels.length === 1);
    assert(rels[0].to === 't');
  });

  await test('vue scanSource: emits RENDERS for <PascalCase /> tag', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'p', name: 'parent', kind: 'function', file: 'src/Parent.vue', line: [1, 50], lang: 'vue' },
      { id: 'c', name: 'UserCard', kind: 'component', file: 'src/UserCard.vue', line: [1, 30], lang: 'vue' },
    ]);
    const src = '<template>\n  <UserCard :user="u" />\n</template>\n<script>\nexport default { name: "parent" };\n</script>';
    const rels = vueResolver.scanSource(src, 'src/Parent.vue', g);
    assert(rels.length === 1, `expected 1, got ${rels.length}`);
    assert(rels[0].kind === 'RENDERS');
    assert(rels[0].to === 'c');
  });

  await test('django scanSource: emits CALLS for path("/", view)', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'v', name: 'user_detail', kind: 'function', file: 'app/views.py', line: [10, 30], lang: 'python', exported: true },
    ]);
    const src = "from django.urls import path\nfrom .views import user_detail\nurlpatterns = [path('users/<int:pk>/', user_detail)]";
    const rels = djangoResolver.scanSource(src, 'app/urls.py', g);
    assert(rels.length === 1);
    assert(rels[0].to === 'v');
  });

  await test('svelte scanSource: emits RENDERS for <Component /> + custom function CALLS', async () => {
    const { svelteResolver } = await import('../scripts/lib/code-intel/resolution/frameworks/svelte.mjs');
    const { CodeGraph } = await import('../scripts/lib/code-intel/graph.mjs');
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'p', name: 'Page',     kind: 'component', file: 'src/Page.svelte',    line: [1, 30], lang: 'svelte' },
      { id: 'c', name: 'UserCard', kind: 'component', file: 'src/UserCard.svelte', line: [1, 20], lang: 'svelte' },
    ]);
    const src = '<script>\n  import UserCard from "./UserCard.svelte";\n</script>\n<UserCard user={u} />';
    const rels = svelteResolver.scanSource(src, 'src/Page.svelte', g);
    assert(rels.length >= 1, `expected at least 1 relation, got ${rels.length}`);
    const rendersRel = rels.find(r => r.kind === 'RENDERS');
    assert(rendersRel, 'expected RENDERS relation');
    assert(rendersRel.to === 'c');
    assert(rendersRel._meta.resolvedBy === 'framework:svelte');
  });

  await test('svelte scanSource: skips Svelte runes', async () => {
    const { svelteResolver } = await import('../scripts/lib/code-intel/resolution/frameworks/svelte.mjs');
    const { CodeGraph } = await import('../scripts/lib/code-intel/graph.mjs');
    const g = new CodeGraph();
    // No matching symbol for $state — should produce no relations.
    const src = '<script>\n  let x = $state(0);\n  let y = $derived(x * 2);\n</script>';
    const rels = svelteResolver.scanSource(src, 'src/Cmp.svelte', g);
    assert(rels.length === 0, `runes should be skipped, got ${rels.length} rels`);
  });

  await test('rails scanSource: emits CALLS for controller#action route', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'a', name: 'index', kind: 'method', file: 'app/controllers/users_controller.rb', line: [5, 20], lang: 'ruby', parent: 'UsersController' },
    ]);
    const src = "Rails.application.routes.draw do\n  get '/users' => 'users#index'\nend";
    const rels = railsResolver.scanSource(src, 'config/routes.rb', g);
    assert(rels.length === 1);
    assert(rels[0].to === 'a');
  });
}

async function svelteExtractorTests() {
  console.log('\n🎯 Svelte SFC Extractor Tests (Phase 07)');
  const { extractSvelteSfc, isSvelteSfc } = await import('../scripts/lib/code-intel/extractor-svelte-sfc.mjs');

  await test('isSvelteSfc: recognizes .svelte files', () => {
    assert(isSvelteSfc('src/Foo.svelte') === true);
    assert(isSvelteSfc('src/Foo.vue') === false);
    assert(isSvelteSfc('src/foo.ts') === false);
  });

  await test('extractSvelteSfc: derives PascalCase name from filename', () => {
    const { symbols } = extractSvelteSfc('<script>let x = 1;</script>', 'src/components/user-card.svelte');
    const comp = symbols.find(s => s.kind === 'component');
    assert(comp.name === 'UserCard', `expected UserCard, got ${comp.name}`);
  });

  await test('extractSvelteSfc: extracts export let props', () => {
    const src = '<script>\n  export let user;\n  export let onClick;\n</script>';
    const { symbols } = extractSvelteSfc(src, 'src/UserCard.svelte');
    const props = symbols.filter(s => s.kind === 'variable' && s.exported);
    assert(props.length === 2, `expected 2 props, got ${props.length}`);
    assert(props.find(p => p.name === 'user'));
    assert(props.find(p => p.name === 'onClick'));
  });

  await test('extractSvelteSfc: extracts internal + exported functions', () => {
    const src = '<script>\n  export function publicFn() {}\n  function privateFn() {}\n</script>';
    const { symbols } = extractSvelteSfc(src, 'src/Cmp.svelte');
    const methods = symbols.filter(s => s.kind === 'method');
    assert(methods.length === 2, `expected 2 methods, got ${methods.length}`);
    assert(methods.find(m => m.name === 'publicFn' && m.exported));
    assert(methods.find(m => m.name === 'privateFn' && !m.exported));
  });

  await test('extractSvelteSfc: MEMBER_OF relations link methods to component', () => {
    const src = '<script>\n  function a() {}\n  function b() {}\n</script>';
    const { symbols, relations } = extractSvelteSfc(src, 'src/Cmp.svelte');
    const memberOf = relations.filter(r => r.kind === 'MEMBER_OF');
    assert(memberOf.length === 2, `expected 2 MEMBER_OF, got ${memberOf.length}`);
    const comp = symbols.find(s => s.kind === 'component');
    for (const r of memberOf) {
      assert(r.to === comp.id, `MEMBER_OF target should be component, got ${r.to}`);
    }
  });
}

async function liquidExtractorTests() {
  console.log('\n🛍️  Liquid Extractor + Shopify Resolver Tests (Phase 07)');
  const { extractLiquid, isLiquid } = await import('../scripts/lib/code-intel/extractor-liquid.mjs');
  const { shopifyResolver } = await import('../scripts/lib/code-intel/resolution/frameworks/shopify.mjs');
  const { CodeGraph } = await import('../scripts/lib/code-intel/graph.mjs');

  await test('isLiquid: recognizes .liquid files', () => {
    assert(isLiquid('snippets/product-card.liquid') === true);
    assert(isLiquid('src/Foo.vue') === false);
  });

  await test('extractLiquid: emits component symbol with directory-inferred kind', () => {
    const { symbols } = extractLiquid('<div>{{ x }}</div>', 'snippets/product-card.liquid');
    const c = symbols[0];
    assert(c.name === 'product-card');
    assert(c.kind === 'component');
    assert(c.lang === 'liquid');
    assert(c._liquidKind === 'snippet');
  });

  await test('extractLiquid: section directory → liquidKind=section', () => {
    const { symbols } = extractLiquid('', 'sections/featured.liquid');
    assert(symbols[0]._liquidKind === 'section');
  });

  await test('shopify scanSource: emits RENDERS for {% render \'snippet\' %}', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'sn', name: 'product-card', kind: 'component', file: 'snippets/product-card.liquid', line: [1, 5], lang: 'liquid' },
      { id: 'sec', name: 'featured', kind: 'component', file: 'sections/featured.liquid', line: [1, 10], lang: 'liquid' },
    ]);
    const src = '<section>\n  {% render \'product-card\' %}\n</section>';
    const rels = shopifyResolver.scanSource(src, 'sections/featured.liquid', g);
    assert(rels.length === 1, `expected 1 RENDERS, got ${rels.length}`);
    assert(rels[0].kind === 'RENDERS');
    assert(rels[0].to === 'sn');
    assert(rels[0]._meta.resolvedBy === 'framework:shopify');
  });

  await test('shopify scanSource: {% section \'name\' %} resolves', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'tmp', name: 'index', kind: 'component', file: 'templates/index.liquid', line: [1, 10], lang: 'liquid' },
      { id: 'sec', name: 'featured', kind: 'component', file: 'sections/featured.liquid', line: [1, 10], lang: 'liquid' },
    ]);
    const src = '{% section \'featured\' %}';
    const rels = shopifyResolver.scanSource(src, 'templates/index.liquid', g);
    assert(rels.length === 1);
    assert(rels[0].to === 'sec');
  });
}

async function parsePoolTests() {
  console.log('\n🏊 Parse Pool Tests (Phase 05)');
  const { ParsePool } = await import('../scripts/lib/code-intel/parse-pool.mjs');

  await test('ParsePool: extractSymbols on JS source', async () => {
    const pool = new ParsePool();
    try {
      const res = await pool.extractSymbols('foo.js', 'function bar() {}\nclass Baz {}');
      assert(Array.isArray(res.symbols), 'symbols should be array');
      assert(res.symbols.length >= 1, `expected at least 1 symbol, got ${res.symbols.length}`);
      assert(res.symbols.find(s => s.name === 'bar'), 'expected fn bar');
    } finally {
      await pool.shutdown();
    }
  });

  await test('ParsePool: extractRelations uses cached AST', async () => {
    const pool = new ParsePool();
    try {
      const src = 'function a() { b(); }\nfunction b() {}';
      await pool.extractSymbols('mod.js', src);
      const symMap = new Map([['a', 'mod.js::a'], ['b', 'mod.js::b']]);
      const res = await pool.extractRelations('mod.js', src, symMap);
      assert(Array.isArray(res.relations), 'relations should be array');
    } finally {
      await pool.shutdown();
    }
  });

  await test('ParsePool: shutdown is idempotent', async () => {
    const pool = new ParsePool();
    await pool.shutdown();
    await pool.shutdown(); // should not throw
    assert(true);
  });

  await test('ParsePool: unsupported file returns empty symbols', async () => {
    const pool = new ParsePool();
    try {
      const res = await pool.extractSymbols('foo.unknown', 'random data');
      assert(Array.isArray(res.symbols));
      assert(res.symbols.length === 0);
    } finally {
      await pool.shutdown();
    }
  });
}

async function phase01QuickWinsTests() {
  console.log('\n⚡ Phase 01 Quick Wins Tests');
  const { makeSymbolId, idMode } = await import('../scripts/lib/code-intel/id-gen.mjs');
  const { stripCommentsForRegex } = await import('../scripts/lib/code-intel/strip-comments.mjs');
  const { getOutputBudget, getExploreBudget } = await import('../scripts/lib/code-intel/output-budget.mjs');

  // ── id-gen ──
  await test('id-gen: legacy mode default', () => {
    delete process.env.HERMIT_ID_MODE;
    assert(idMode() === 'legacy');
    const id = makeSymbolId({ file: 'src/a.ts', kind: 'function', name: 'foo', line: 10 });
    assert(id === 'src/a.ts::foo', `unexpected legacy id: ${id}`);
  });

  await test('id-gen: legacy mode with parent', () => {
    delete process.env.HERMIT_ID_MODE;
    const id = makeSymbolId({ file: 'src/a.ts', kind: 'method', name: 'bar', line: 20, parent: 'Foo' });
    assert(id === 'src/a.ts::Foo.bar', `unexpected: ${id}`);
  });

  await test('id-gen: sha256 mode produces stable 32-char hash', () => {
    process.env.HERMIT_ID_MODE = 'sha256';
    const a = makeSymbolId({ file: 'src/a.ts', kind: 'function', name: 'foo', line: 10 });
    const b = makeSymbolId({ file: 'src/a.ts', kind: 'function', name: 'foo', line: 10 });
    assert(a === b, `deterministic: ${a} vs ${b}`);
    assert(a.startsWith('function:'), `expected kind prefix: ${a}`);
    assert(a.length === 'function:'.length + 32, `expected 32-char hash, got ${a.length - 'function:'.length}`);
    delete process.env.HERMIT_ID_MODE;
  });

  await test('id-gen: sha256 different inputs → different ids', () => {
    process.env.HERMIT_ID_MODE = 'sha256';
    const a = makeSymbolId({ file: 'src/a.ts', kind: 'function', name: 'foo', line: 10 });
    const b = makeSymbolId({ file: 'src/a.ts', kind: 'function', name: 'foo', line: 11 });
    assert(a !== b, 'different lines should produce different ids');
    delete process.env.HERMIT_ID_MODE;
  });

  // ── strip-comments ──
  await test('strip-comments: JS line comment blanked, length preserved', () => {
    const src = 'const x = 1; // comment here\nconst y = 2;';
    const out = stripCommentsForRegex(src, 'javascript');
    assert(out.length === src.length, `length changed: ${src.length} -> ${out.length}`);
    assert(!out.includes('comment here'), 'comment text should be blanked');
    assert(out.includes('const x = 1;') && out.includes('const y = 2;'), 'code preserved');
  });

  await test('strip-comments: JS block comment blanked across lines', () => {
    const src = 'before\n/* block\nspanning\nlines */ after';
    const out = stripCommentsForRegex(src, 'javascript');
    assert(out.length === src.length, 'length preserved');
    // Newlines inside block must be preserved.
    assert((out.match(/\n/g) || []).length === (src.match(/\n/g) || []).length, 'newline count preserved');
    assert(out.includes('after'), 'code after block preserved');
  });

  await test('strip-comments: // inside string is NOT blanked', () => {
    const src = 'const url = "https://example.com/path";';
    const out = stripCommentsForRegex(src, 'javascript');
    assert(out === src, `expected unchanged, got: ${out}`);
  });

  await test('strip-comments: Python triple-quoted docstring blanked', () => {
    const src = 'def foo():\n    """docstring\n    spans lines"""\n    return 1';
    const out = stripCommentsForRegex(src, 'python');
    assert(out.length === src.length, 'length preserved');
    assert(!out.includes('docstring'), 'docstring blanked');
    assert(out.includes('def foo():') && out.includes('return 1'), 'code preserved');
  });

  await test('strip-comments: Python # comment blanked', () => {
    const src = 'x = 1  # explanation\ny = 2';
    const out = stripCommentsForRegex(src, 'python');
    assert(out.length === src.length);
    assert(!out.includes('explanation'));
  });

  await test('strip-comments: unknown language passes through', () => {
    const src = '// not stripped';
    const out = stripCommentsForRegex(src, 'klingon');
    assert(out === src);
  });

  // ── output-budget ──
  await test('output-budget: tier boundaries', () => {
    const tiny = getOutputBudget(100);
    assert(tiny.maxOutputChars === 18000, `tiny maxOutputChars: ${tiny.maxOutputChars}`);
    assert(tiny.includeBudgetNote === false, 'tiny should not include budget note');

    const small = getOutputBudget(1000);
    assert(small.maxOutputChars === 13000);
    assert(small.includeBudgetNote === true);

    const medium = getOutputBudget(10000);
    assert(medium.maxOutputChars === 35000);

    const large = getOutputBudget(20000);
    assert(large.maxOutputChars === 38000);
  });

  await test('output-budget: explore budget scales with size', () => {
    assert(getExploreBudget(100) === 1);
    assert(getExploreBudget(2000) === 2);
    assert(getExploreBudget(10000) === 3);
    assert(getExploreBudget(20000) === 4);
    assert(getExploreBudget(50000) === 5);
  });
}

async function frameworkResolverPackTests() {
  console.log('\n🛣️  Framework Resolver Pack Tests (Phase 04 wave 2)');
  const { laravelResolver } = await import('../scripts/lib/code-intel/resolution/frameworks/laravel.mjs');
  const { nestjsResolver }  = await import('../scripts/lib/code-intel/resolution/frameworks/nestjs.mjs');
  const { reactResolver }   = await import('../scripts/lib/code-intel/resolution/frameworks/react.mjs');
  const { vueResolver }     = await import('../scripts/lib/code-intel/resolution/frameworks/vue.mjs');
  const { djangoResolver }  = await import('../scripts/lib/code-intel/resolution/frameworks/django.mjs');
  const { railsResolver }   = await import('../scripts/lib/code-intel/resolution/frameworks/rails.mjs');
  const { CodeGraph } = await import('../scripts/lib/code-intel/graph.mjs');

  // ── Laravel ──
  await test('laravel: [Controller::class, method] resolves', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'm1', name: 'store', kind: 'method', file: 'app/Http/Controllers/CheckoutController.php', line: [10, 20], lang: 'php', parent: 'CheckoutController' },
    ]);
    const r = laravelResolver.resolve(
      { sourceId: 'x', referenceKind: 'calls', contextText: "[CheckoutController::class, 'store']" },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'm1', `expected m1, got ${r.targetId}`);
    assert(r.confidence === 0.88);
  });

  await test('laravel: Model::method resolves to method on class', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'mf', name: 'find', kind: 'method', file: 'app/Models/User.php', line: [5, 15], lang: 'php', parent: 'User' },
    ]);
    const r = laravelResolver.resolve(
      { sourceId: 'x', referenceKind: 'calls', contextText: 'User::find($id)' },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'mf');
  });

  await test('laravel: Facade::method has lower confidence', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'fc', name: 'Auth', kind: 'class', file: 'vendor/laravel/.../Auth.php', line: [1, 1], lang: 'php' },
    ]);
    const r = laravelResolver.resolve(
      { sourceId: 'x', referenceKind: 'calls', contextText: 'Auth::user()' },
      { graph: g }
    );
    assert(r, 'expected facade resolution');
    assert(r.confidence === 0.7, `expected 0.7, got ${r.confidence}`);
  });

  await test('laravel: no contextText → null', () => {
    assert(laravelResolver.resolve({ sourceId: 'x', referenceKind: 'calls' }, { graph: new CodeGraph() }) === null);
  });

  // ── NestJS ──
  await test('nestjs: @Inject(TOKEN) resolves token', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'tk', name: 'USER_REPO', kind: 'constant', file: 'src/tokens.ts', line: [3, 3], lang: 'typescript' },
    ]);
    const r = nestjsResolver.resolve(
      { sourceId: 'x', referenceKind: 'references', contextText: '@Inject(USER_REPO)' },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'tk');
  });

  await test('nestjs: @Controller decorator returns null (marker only)', () => {
    const r = nestjsResolver.resolve(
      { sourceId: 'x', referenceKind: 'calls', contextText: "@Controller('/users')" },
      { graph: new CodeGraph() }
    );
    assert(r === null, `expected null for marker, got ${JSON.stringify(r)}`);
  });

  // ── React ──
  await test('react: JSX <Component /> resolves to component', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'cp', name: 'UserCard', kind: 'function', file: 'src/components/UserCard.tsx', line: [10, 50], lang: 'typescript', exported: true },
    ]);
    const r = reactResolver.resolve(
      { sourceId: 'x', referenceKind: 'renders', contextText: '<UserCard userId={id} />' },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'cp');
    assert(r.kind === 'renders');
  });

  await test('react: builtin hook (useState) returns null', () => {
    const r = reactResolver.resolve(
      { sourceId: 'x', referenceKind: 'calls', contextText: 'const [x, setX] = useState(0);' },
      { graph: new CodeGraph() }
    );
    assert(r === null, `expected null for builtin, got ${JSON.stringify(r)}`);
  });

  await test('react: custom hook resolves to project function', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'hk', name: 'useUserProfile', kind: 'function', file: 'src/hooks/use-user-profile.ts', line: [5, 30], lang: 'typescript', exported: true },
    ]);
    const r = reactResolver.resolve(
      { sourceId: 'x', referenceKind: 'calls', contextText: 'const profile = useUserProfile(userId);' },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'hk');
  });

  // ── Vue ──
  await test('vue: <PascalCase /> tag resolves', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'vc', name: 'UserCard', kind: 'component', file: 'src/components/UserCard.vue', line: [1, 80], lang: 'vue' },
    ]);
    const r = vueResolver.resolve(
      { sourceId: 'x', referenceKind: 'renders', contextText: '<UserCard :user="user" />' },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'vc');
  });

  await test('vue: <kebab-case /> tag resolves via PascalCase conversion', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'vc', name: 'UserCard', kind: 'component', file: 'src/components/UserCard.vue', line: [1, 80], lang: 'vue' },
    ]);
    const r = vueResolver.resolve(
      { sourceId: 'x', referenceKind: 'renders', contextText: '<user-card :user="user" />' },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'vc', `expected vc via kebab→Pascal, got ${r.targetId}`);
  });

  // ── Django ──
  await test('django: path("url/", view) resolves view function', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'vw', name: 'user_detail', kind: 'function', file: 'app/views.py', line: [10, 30], lang: 'python', exported: true },
    ]);
    const r = djangoResolver.resolve(
      { sourceId: 'x', referenceKind: 'calls', contextText: "path('users/<int:pk>/', user_detail)" },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'vw');
  });

  await test('django: path with module prefix (views.user_detail) resolves', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'vw', name: 'user_detail', kind: 'function', file: 'app/views.py', line: [10, 30], lang: 'python', exported: true },
    ]);
    const r = djangoResolver.resolve(
      { sourceId: 'x', referenceKind: 'calls', contextText: "path('users/', views.user_detail)" },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'vw');
  });

  // ── Rails ──
  await test('rails: get "/path" => "controller#action" resolves', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'rc', name: 'index', kind: 'method', file: 'app/controllers/users_controller.rb', line: [5, 20], lang: 'ruby', parent: 'UsersController' },
    ]);
    const r = railsResolver.resolve(
      { sourceId: 'x', referenceKind: 'calls', contextText: "get '/users' => 'users#index'" },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'rc');
  });

  await test('rails: before_action :method_name resolves', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'cb', name: 'authenticate_user', kind: 'method', file: 'app/controllers/application_controller.rb', line: [10, 20], lang: 'ruby', parent: 'ApplicationController' },
    ]);
    const r = railsResolver.resolve(
      { sourceId: 'x', referenceKind: 'calls', contextText: 'before_action :authenticate_user' },
      { graph: g }
    );
    assert(r, 'expected resolution');
    assert(r.targetId === 'cb');
  });
}

// MAIN
// ══════════════════════════════════════════════════════════════════════════

console.log('Hermit Graph v4 Test Suite');
console.log('=========================');
setup();

try {
  await brainIoTests();
  await auditTrailTests();
  await branchContextTests();
  await migrationTests();
  await healthCheckTests();
  await codeIntelTests();
  await commandExportTests();
  await hookExportTests();
  await mcpIntegrationTests();
  await skillIndexTests();
  await recallCoreTests();
  await entityExtractorTests();
  await frontmatterTests();
  await resolutionTests();
  await frameworkResolverTests();
  await frameworkResolverPackTests();
  await scanSourceTests();
  await svelteExtractorTests();
  await liquidExtractorTests();
  await parsePoolTests();
  await phase01QuickWinsTests();
} finally {
  cleanup();
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed > 0 ? 1 : 0);
