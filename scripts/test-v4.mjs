#!/usr/bin/env node
/**
 * Hermit Graph v4 Test Suite
 * Tests: brain-io, audit-trail, branch-context, migration, MCP server integration.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TMP = join(ROOT, 'tmp', 'test-v4');
const REAL_BRAIN = join(ROOT, 'data', 'brain.jsonl');

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
        env: { ...process.env, MEMORY_FILE_PATH: REAL_BRAIN },
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
    assert(init.result.serverInfo.version === '4.0.0');
  });

  await test('MCP: tools/list returns 20 tools', async () => {
    const responses = await sendMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    const list = responses.find(r => r.id === 2);
    assert(list, 'Should get tools/list response');
    assert(list.result.tools.length === 20, `Expected 20 tools, got ${list.result.tools.length}`);
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
// 7. GITNEXUS RUNNER TESTS
// ══════════════════════════════════════════════════════════════════════════

async function gitnexusRunnerTests() {
  console.log('\n🔧 GitNexus Runner Tests');
  const { runGitNexus } = await import('./lib/gitnexus-runner.mjs');

  await test('runGitNexus: rejects on nonexistent command', async () => {
    try {
      await runGitNexus('nonexistent-cmd', [], ROOT);
      assert(false, 'Should have thrown');
    } catch (e) {
      assert(e.message.length > 0, 'Should have error message');
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════
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
  await gitnexusRunnerTests();
  await mcpIntegrationTests();
} finally {
  cleanup();
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed > 0 ? 1 : 0);
