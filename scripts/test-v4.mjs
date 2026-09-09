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

async function withHookStore(label, run) {
 const {BrainStore}=await import('./lib/storage/brain-store.mjs');
 const {resolveProject}=await import('./lib/storage/project-resolver.mjs');
 const {tmpdir}=await import('node:os');const root=join(tmpdir(),'hermit-test-v4-'+label+'-'+process.pid);mkdirSync(root,{recursive:true});
 const keys=['HERMIT_DATA_DIR','HERMIT_DB_PATH','HERMIT_USER_CWD','HERMIT_PACKAGE_ROOT'];const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{HERMIT_DATA_DIR:join(root,'data'),HERMIT_DB_PATH:join(root,'data','brain.db'),HERMIT_USER_CWD:root,HERMIT_PACKAGE_ROOT:ROOT});
 const store=new BrainStore({dbPath:process.env.HERMIT_DB_PATH});
 try {const project=resolveProject(store,{rootPath:root,create:true});return await run(store,project.id);}finally{store.close();for(const k of keys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}rmSync(root,{recursive:true,force:true});}
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
  const branchMod = await import('./lib/branch-context.mjs');
  const { detectBranch } = branchMod;

  await test('detectBranch: returns branch name', () => {
    const branch = detectBranch(ROOT);
    assert(typeof branch === 'string' && branch.length > 0, `Got: ${branch}`);
    assert(branch !== 'unknown', 'Should detect branch in git repo');
  });

  await test('detectBranch: returns unknown for non-git dir', () => {
    const branch = detectBranch('/tmp');
    assert(branch === 'unknown', `Expected unknown, got: ${branch}`);
  });

  await test('branch filter removed (was a no-op that hid memory)', () => {
    // The filter was set by session_start but never read by any search path,
    // and no observation was ever branch-tagged. Removed rather than finished:
    // branch-scoped recall would silently drop knowledge on branch switches.
    for (const gone of ['setBranchFilter', 'getBranchFilter', 'clearBranchFilter', 'isObservationVisible']) {
      assert(!(gone in branchMod), `${gone} should no longer be exported`);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SESSION RECORDS (append-only, per-session)
// ══════════════════════════════════════════════════════════════════════════

async function sessionRecordTests() {
 const sc=(await import('node:module')).createRequire(import.meta.url)('../catalog/hooks/lib/session-core.cjs');
 await withHookStore('sessions',async(store,projectId)=>{
 const dir=process.env.HERMIT_USER_CWD;let first;
 await test('session: missing stable ID degrades without writing',()=>{assert(sc.startSession(dir,'codex').degraded);assert(sc.listSessions(dir).length===0);});
 await test('session: stable client identity persists in SQLite',()=>{first=sc.startSession(dir,'codex','upstream-one');assert(first.status==='OPEN');assert(!existsSync(join(dir,'.hermit','sessions')));});
 await test('session: separate hook process reuses same session',()=>{assert(sc.startSession(dir,'codex','upstream-one').sessionId===first.sessionId);assert(sc.listSessions(dir).length===1);});
 await test('session: agent identity prevents collisions',()=>{const other=sc.startSession(dir,'claude','upstream-one');assert(other.sessionId!==first.sessionId);assert(sc.listSessions(dir).length===2);});
 await test('session: end only closes matching client identity',()=>{assert(sc.endSession(dir,'codex','upstream-one').status==='CLOSED');assert(sc.listSessions(dir).find(s=>s.agent==='claude').status==='OPEN');});
 await test('session: expired stable sessions become abandoned',()=>{store.db.prepare("UPDATE runtime_sessions SET heartbeat_at=0 WHERE agent='claude'").run();sc.startSession(dir,'claude','upstream-two');assert(sc.listSessions(dir).some(s=>s.status==='ABANDONED'));});
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
      const proc = spawn('node', [join(ROOT, 'scripts', 'hermit-mcp-legacy.mjs')], {
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

  await test('expandRelations: returns empty on empty scoped brain', () => withHookStore('expand-empty',()=>{assert(core.expandRelations([{id:'absent',name:'E1'}]).length===0,'Empty graph has no related entities');}));

  await test('expandRelations: finds related scoped SQLite entities', () => withHookStore('expand-related',(store,projectId)=>{
 const from=store.createEntity({name:'BIZ:Fixture',entityType:'biz-domain',projectId,observations:[]}).entity;
 for(let i=0;i<5;i++){const target=store.createEntity({name:'TECH:Fixture:'+i,entityType:'tech-stack',projectId,observations:['related']}).entity;store.createRelation({fromEntityId:from.id,toEntityId:target.id,relationType:'uses_tech'});}
 const expanded=core.expandRelations([from]);assert(expanded.length===core.MAX_EXPANSION,'Related entities respect expansion cap');assert(expanded.every(e=>e.id!==from.id),'Seed entity is not repeated');
 }));

  // ── High-level recall() ──

  await test('recall: returns null for empty prompt', () => withHookStore('recall-empty',()=>{assert(core.recall('')===null,'Empty prompt should return null');}));

  await test('recall: returns output for keyword-rich prompt', () => withHookStore('recall-keyword',(store,projectId)=>{
 store.createEntity({name:'PATTERN:Portability',entityType:'pattern-code',projectId,observations:['opencode skill portability']});const output=core.recall('tell me about opencode skill portability');assert(typeof output==='string'&&output.includes('PATTERN:Portability'),'Scoped SQLite match should be injected');
 }));
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

  await test('filterExisting: removes known SQLite entities', () => withHookStore('filter-known',(store,projectId)=>{
 store.createEntity({name:'TECH:Decision:PostgreSQL',entityType:'tech-decision',projectId,observations:[]});
 const filtered=ext.filterExisting([{name:'TECH:Decision:PostgreSQL',entityType:'tech-decision',observations:['dup']},{name:'TECH:Decision:Redis',entityType:'tech-decision',observations:['new']}]);assert(filtered.length===1,'Only new entity remains');assert(filtered[0].name==='TECH:Decision:Redis','Expected Redis');
 }));

  await test('filterExisting: preserves distinct case-sensitive canonical names', () => withHookStore('filter-case',(store,projectId)=>{
 store.createEntity({name:'tech:decision:postgresql',entityType:'tech-decision',projectId,observations:[]});
 const filtered=ext.filterExisting([{name:'TECH:Decision:PostgreSQL',entityType:'tech-decision',observations:['test']}]);assert(filtered.length===1,'SQLite canonical names are case-sensitive; distinct names must not silently merge');
 }));

  // ── appendToBrain ──

  await test('appendToBrain: persists scoped candidates in SQLite', () => withHookStore('append-candidate',(store,projectId)=>{
 const written=ext.appendToBrain([{name:'TECH:Decision:Redis',entityType:'tech-decision',observations:['Chose Redis for caching']}]);assert(written===1,'One candidate captured');
 const obj=store.getEntity({name:'TECH:Decision:Redis',projectId,lifecycles:['candidate']});assert(obj?.name==='TECH:Decision:Redis','Candidate is durable');assert(obj.observations[0].content.includes('[0.5|'),'Auto confidence prefix preserved');assert(store.search('Redis',{projectId}).length===0,'Candidate excluded from default recall');assert(ext.appendToBrain([{name:obj.name,entityType:obj.entityType,observations:['duplicate']}])===0,'Repeated capture is idempotent');
 }));

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

async function vueExtractorTests() {
  console.log('\n🎯 Vue SFC Extractor Tests (Phase 07)');
  const { extractVueSfc, isVueSfc } = await import('../scripts/lib/code-intel/extractor-vue-sfc.mjs');

  await test('isVueSfc: recognizes .vue files', () => {
    assert(isVueSfc('src/Foo.vue') === true);
    assert(isVueSfc('src/Foo.svelte') === false);
  });

  await test('vue variant 1: <script> with explicit name field', () => {
    const src = '<template>\n  <div>hi</div>\n</template>\n<script>\nexport default { name: "MyExplicit" };\n</script>';
    const { symbols } = extractVueSfc(src, 'src/Anything.vue');
    const c = symbols.find(s => s.kind === 'component');
    assert(c.name === 'MyExplicit', `expected MyExplicit, got ${c.name}`);
  });

  await test('vue variant 2: no name field falls back to PascalCase filename', () => {
    const src = '<template><div /></template>\n<script>\nexport default {};\n</script>';
    const { symbols } = extractVueSfc(src, 'components/user-card.vue');
    const c = symbols.find(s => s.kind === 'component');
    assert(c.name === 'UserCard', `expected UserCard, got ${c.name}`);
  });

  await test('vue variant 3: extracts methods inside methods: {} block', () => {
    const src = '<script>\nexport default {\n  name: "X",\n  methods: {\n    handleClick() {},\n    submit() {}\n  }\n};\n</script>';
    const { symbols } = extractVueSfc(src, 'src/X.vue');
    const methods = symbols.filter(s => s.kind === 'method');
    assert(methods.length >= 2, `expected 2+ methods, got ${methods.length}`);
    assert(methods.find(m => m.name === 'handleClick'));
    assert(methods.find(m => m.name === 'submit'));
  });

  await test('vue variant 4: extracts computed properties', () => {
    const src = '<script>\nexport default {\n  computed: {\n    fullName() { return this.first + this.last; }\n  }\n};\n</script>';
    const { symbols } = extractVueSfc(src, 'src/Greeting.vue');
    assert(symbols.find(s => s.name === 'fullName'));
  });

  await test('vue line-offset preservation: methods report file line, not script-local', () => {
    // <script> starts at line 5. Method is at script-relative line 3 = file line 8.
    const src = '<template>\n  <div>\n  </div>\n</template>\n<script>\nexport default {\n  methods: {\n    target() {}\n  }\n};\n</script>';
    const { symbols } = extractVueSfc(src, 'src/X.vue');
    const m = symbols.find(s => s.name === 'target');
    assert(m, 'expected target method');
    // Should report somewhere in the script block range (lines 5-11), not lines 0-3.
    assert(m.line[0] >= 5 && m.line[0] <= 11, `expected line in 5-11, got ${m.line[0]}`);
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

// ══════════════════════════════════════════════════════════════════════════
// DOCTOR — redaction, session parsing, call stats, timeout guard
// ══════════════════════════════════════════════════════════════════════════

async function doctorTests() {
  console.log('\n🩹 Doctor / Observability Tests');
  const { redact, redactText, hasSecret } = await import('./lib/redact-secrets.mjs');
  const { parseSessionFile, detectError, errorFingerprint } =
    await import('./lib/session-audit/session-jsonl-parser.mjs');
  const { summarize, dedupeByCallId } = await import('./lib/session-audit/call-stats.mjs');
  const { withTimeout } = await import('./lib/with-timeout.mjs');

  // ── Redaction is a hard gate ──
  await test('redact: provider keys, tokens and connection strings masked', () => {
    const samples = [
      'ANTHROPIC_API_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAA',
      'export OPENAI_KEY=sk-proj-BBBBBBBBBBBBBBBBBBBBBBBB',
      'token: ghp_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      'GOOGLE=AIzaDDDDDDDDDDDDDDDDDDDDDDDDDDD',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
      'Server=db;Password=Sup3rS3cret!;',
      'postgres://admin:hunter2@db.internal:5432/app',
      'aws AKIAIOSFODNN7EXAMPLE',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop',
    ];
    for (const s of samples) {
      const out = redactText(s);
      assert(out.includes('[REDACTED]'), `not masked: ${s} → ${out}`);
      assert(!hasSecret(out), `still leaks after redaction: ${out}`);
    }
  });

  await test('redact: assignment key stays visible so reports stay useful', () => {
    const out = redactText('api_key = abcdef123456');
    assert(/api_key/i.test(out), `key label preserved: ${out}`);
    assert(out.includes('[REDACTED]'), 'value masked');
  });

  await test('redact: ordinary text untouched', () => {
    const plain = 'checkMissingRelations flagged 110 of 190 pairs';
    assert(redactText(plain) === plain, 'no false rewrite');
    assert(Object.keys(redact(plain).hits).length === 0, 'no hits on clean text');
  });

  // ── Error detection precision ──
  await test('doctor: error markers only count near the start of output', () => {
    assert(detectError("Error: Cannot read properties of null (reading 'preloadSymbols')"), 'real failure detected');
    // A successful session_start echoes INCIDENT observations that contain
    // words like "timed out" — those must not be read as failures.
    const healthy = '## Hermit Session Context\n' + 'x'.repeat(500) + '\nSYMPTOM: request timed out after 30s';
    assert(detectError(healthy) === null, 'recalled incident text is not a failure');
  });

  await test('doctor: fingerprints normalize paths, hashes and numbers', () => {
    const a = errorFingerprint("Error: ENOENT: no such file 'D:\\Project\\a\\b.mjs' (code 12345)");
    const b = errorFingerprint("Error: ENOENT: no such file 'C:\\Other\\x\\y.mjs' (code 999)");
    assert(a === b, `same fault groups: \n${a}\n${b}`);
  });

  // ── Parsing + stats ──
  await test('doctor: parses mcp_tool_call_end telemetry with duration + isError', () => {
    const file = join(TMP, 'sess.jsonl');
    const lines = [
      JSON.stringify({
        timestamp: '2026-07-29T05:13:01.358Z', type: 'event_msg',
        payload: {
          type: 'mcp_tool_call_end', call_id: 'call_A',
          invocation: { server: 'hermit-graph', tool: 'hermit_impact', arguments: {} },
          duration: { secs: 1, nanos: 500000000 },
          result: { Ok: { content: [{ type: 'text', text: "Error: Cannot read properties of null (reading 'preloadSymbols')" }], isError: true } },
        },
      }),
      JSON.stringify({
        timestamp: '2026-07-29T05:14:01.000Z', type: 'event_msg',
        payload: {
          type: 'mcp_tool_call_end', call_id: 'call_B',
          invocation: { server: 'hermit-graph', tool: 'hermit_search_nodes', arguments: {} },
          duration: { secs: 0, nanos: 26000000 },
          result: { Ok: { content: [{ type: 'text', text: '3 results' }], isError: false } },
        },
      }),
      'not json at all',
    ];
    writeFileSync(file, lines.join('\n'));
    const { calls, badLines } = parseSessionFile(file, { toolPrefix: 'hermit_' });
    assert(badLines === 1, `malformed line counted, not thrown: ${badLines}`);
    assert(calls.length === 2, `both calls parsed: ${calls.length}`);
    const impact = calls.find(c => c.tool === 'hermit_impact');
    assert(impact.ok === false, 'isError respected');
    assert(impact.durationMs === 1500, `duration from telemetry: ${impact.durationMs}`);
    assert(impact.fingerprint.includes('preloadSymbols'), 'fingerprint captured');
    assert(calls.find(c => c.tool === 'hermit_search_nodes').ok === true, 'success respected');
  });

  await test('doctor: Err result shape (agent-side timeout) counted as failure', () => {
    const file = join(TMP, 'sess-err.jsonl');
    writeFileSync(file, JSON.stringify({
      timestamp: '2026-08-13T07:01:53.264Z', type: 'event_msg',
      payload: {
        type: 'mcp_tool_call_end', call_id: 'call_T',
        invocation: { server: 'hermit-graph', tool: 'hermit_open_nodes', arguments: {} },
        duration: { secs: 300, nanos: 0 },
        result: { Err: 'tool call error: timed out awaiting tools/call after 300s' },
      },
    }));
    const { calls } = parseSessionFile(file, { toolPrefix: 'hermit_' });
    assert(calls[0].ok === false, 'Err counted as failure');
    assert(calls[0].durationMs === 300000, 'timeout duration recorded');
  });

  await test('doctor: dedupe by call_id prefers MCP telemetry over inferred', () => {
    const inferred = { callId: 'x', tool: 't', ok: true, durationMs: null };
    const telemetry = { callId: 'x', tool: 't', ok: false, durationMs: 1500, source: 'mcp_tool_call_end' };
    const kept = dedupeByCallId([inferred, telemetry]);
    assert(kept.length === 1, 'deduped to one');
    assert(kept[0].source === 'mcp_tool_call_end', 'telemetry record wins');
  });

  await test('doctor: stats compute error rate and percentiles', () => {
    const calls = [
      { callId: '1', tool: 'a', ok: true, durationMs: 10 },
      { callId: '2', tool: 'a', ok: true, durationMs: 20 },
      { callId: '3', tool: 'a', ok: false, durationMs: 30, fingerprint: 'boom' },
      { callId: '4', tool: 'b', ok: true, durationMs: 100 },
    ];
    const s = summarize(calls);
    assert(s.totalCalls === 4 && s.totalErrors === 1, 'totals');
    assert(Math.abs(s.errorRate - 0.25) < 1e-9, `error rate: ${s.errorRate}`);
    const a = s.perTool.find(t => t.tool === 'a');
    assert(a.p50Ms === 20 && a.maxMs === 30, `percentiles: p50=${a.p50Ms} max=${a.maxMs}`);
    assert(s.fingerprints[0].fingerprint === 'boom', 'fingerprint aggregated');
  });

  // ── Split-brain regression (found by the consumer-project install test) ──
  await test('mirror gate: SqliteWriter must not be treated as disabled', async () => {
    // The old gate was `ctx.dualWriter.getStats().enabled`. DualWriter reports
    // `enabled`; SqliteWriter — the DEFAULT writer — does not, so the gate was
    // undefined/falsy and NOTHING was written to SQLite while reads came FROM
    // SQLite. Result: every new entity was invisible to hermit_search_nodes /
    // hermit_open_nodes. Measured on the real vault: JSONL 878 vs SQLite 620.
    const { SqliteWriter } = await import('./lib/memory/sqlite-writer.mjs');
    const stats = new SqliteWriter({ sqliteProvider: { }, vectorBackend: null }).getStats();
    assert(stats.enabled === undefined, 'precondition: SqliteWriter has no `enabled` field');

    // The shipped gate must key off the writer's `_sqlite` handle instead.
    const src = readFileSync(join(ROOT, 'scripts', 'lib', 'memory-module.mjs'), 'utf-8');
    const gate = src.slice(src.indexOf('async function mirrorToSqlite'), src.indexOf('async function mirrorToSqlite') + 1400);
    // Match the old EXECUTABLE gate, not the phrase in the explanatory comment.
    assert(!/if \(!ctx\.dualWriter\?\.getStats\(\)\.enabled\)/.test(gate),
      'mirror must not early-return on the DualWriter-only `enabled` field');
    assert(/_sqlite/.test(gate) && /if \(!sqlite\) return/.test(gate), 'mirror gates on the _sqlite handle');
  });

  await test('mirror gate: both writer shapes expose the _sqlite handle', async () => {
    const { SqliteWriter } = await import('./lib/memory/sqlite-writer.mjs');
    const { DualWriter } = await import('./lib/memory/dual-writer.mjs');
    const marker = { tag: 'provider' };
    assert(new SqliteWriter({ sqliteProvider: marker })._sqlite === marker, 'SqliteWriter._sqlite');
    assert(new DualWriter({ jsonlProvider: {}, sqliteProvider: marker, enabled: true })._sqlite === marker, 'DualWriter._sqlite');
  });

  // ── Embedding singleton: model-load stampede ──
  await test('embedding: singleton is the PROMISE, so concurrent cold calls share one load', async () => {
    // getExtractor() used to assign _extractor only AFTER `await pipeline(...)`
    // resolved, so N concurrent callers each started their own ~23MB model load.
    // Session telemetry showed the signature: parallel calls finishing together
    // with a tiny spread (74.8s/74.4s, 262.2s/262.2s, 96.5s/96.4s).
    const src = readFileSync(join(ROOT, 'scripts', 'lib', 'embedding-service.mjs'), 'utf-8');
    assert(/let _loadPromise/.test(src), 'an in-flight load promise is tracked');
    assert(/if \(_loadPromise\) return _loadPromise;/.test(src), 'concurrent callers reuse the in-flight load');
    assert(/LOAD_TIMEOUT_MS/.test(src), 'a hung model load cannot block callers forever');
    const mod = await import('./lib/embedding-service.mjs');
    assert(typeof mod.warmup === 'function', 'warmup() exported for boot-time preload');
  });

  await test('embedding: server warms the model only when vectors are used', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'hermit-mcp-legacy.mjs'), 'utf-8');
    assert(/warmupEmbeddings\(\)/.test(src), 'boot warms embeddings');
    assert(/_retrievalMode !== 'bm25'/.test(src), 'skipped in the default bm25 mode (never embeds)');
  });

  // ── Index parity guard (JSONL = truth, SQLite = derived index) ──
  await test('parity: counts all records so archived entries are not false drift', async () => {
    const { countJsonl } = await import('./lib/memory/index-parity-guard.mjs');
    const p = writeTempBrain('parity.jsonl', [
      { name: 'BIZ:A', entityType: 'biz-domain', observations: ['[1|2026-01-01] WHAT: a'] },
      { name: 'BIZ:B', entityType: 'biz-domain', observations: ['[1|2026-01-01] WHAT: b'], _archived: true },
    ], [{ from: 'BIZ:A', to: 'BIZ:B', relationType: 'uses' }]);
    const c = countJsonl(p);
    assert(c.entities === 2, `archived counted too (index mirrors the file), got ${c.entities}`);
    assert(c.relations === 1, `relations counted, got ${c.relations}`);
  });

  await test('parity: drift is detected and reported with a reason', async () => {
    const { checkIndexParity } = await import('./lib/memory/index-parity-guard.mjs');
    const p = writeTempBrain('parity2.jsonl', [
      { name: 'BIZ:A', entityType: 'biz-domain', observations: ['[1|2026-01-01] WHAT: a'] },
    ]);
    // No DB at that path → index looks empty → drift against 1 JSONL entity.
    const r = checkIndexParity({ brainPath: p, dbPath: join(TMP, 'absent.db') });
    assert(r.inSync === false, 'drift detected');
    assert(/entities 1 vs 0/.test(r.reason), `reason states the counts: ${r.reason}`);
  });

  await test('parity: a fresh vault with no JSONL is not treated as drift', async () => {
    const { ensureIndexParity } = await import('./lib/memory/index-parity-guard.mjs');
    const r = ensureIndexParity({
      brainPath: join(TMP, 'nope.jsonl'),
      dbPath: join(TMP, 'nope.db'),
    });
    assert(r.healed === false && r.checked.inSync === true, 'no rebuild attempted on a fresh vault');
  });

  await test('parity: guard runs before providers open a handle', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'hermit-mcp-legacy.mjs'), 'utf-8');
    const guardAt = src.indexOf('ensureIndexParity({');
    const providerAt = src.indexOf('new SqliteProvider(');
    assert(guardAt > 0 && providerAt > 0, 'both present');
    assert(guardAt < providerAt, 'parity check precedes SqliteProvider construction (no stale handle)');
  });

  // ── Timeout guard ──
  await test('timeout: slow work returns the fallback instead of hanging', async () => {
    const slow = new Promise(res => setTimeout(() => res('late'), 500));
    const r = await withTimeout(slow, { ms: 30, fallback: 'partial' });
    assert(r.timedOut === true, 'timeout reported');
    assert(r.value === 'partial', 'fallback returned');
  });

  await test('timeout: fast work passes through untouched', async () => {
    const r = await withTimeout(Promise.resolve('done'), { ms: 5000, fallback: null });
    assert(r.timedOut === false && r.value === 'done', 'no interference');
  });
}

// ══════════════════════════════════════════════════════════════════════════
// MEMBER-CALL RESOLUTION GATE (false call-graph edges)
// ══════════════════════════════════════════════════════════════════════════

async function memberCallGateTests() {
  console.log('\n🎯 Member Call Resolution Gate Tests');
  const { shouldResolveMemberCall, BUILTIN_RECEIVERS, GENERIC_MEMBER_METHODS } =
    await import('./lib/code-intel/resolution/known-names.mjs');

  await test('gate: builtin receiver never resolves to a user symbol', () => {
    assert(!shouldResolveMemberCall('Set', 'add', 'a/b.mjs::Pool.add', 'c/d.mjs'), 'Set.add dropped');
    assert(!shouldResolveMemberCall('console', 'log', 'a/b.mjs::log', 'c/d.mjs'), 'console.log dropped');
    assert(!shouldResolveMemberCall('Math', 'round', 'a/b.mjs::round', 'c/d.mjs'), 'Math.round dropped');
    assert(!shouldResolveMemberCall('Object', 'fromEntries', 'a/b.mjs::G.fromEntries', 'c/d.mjs'), 'Object.fromEntries dropped');
  });

  await test('gate: generic method on unknown receiver needs corroboration', () => {
    // `relationSet.add(x)` — receiver is a plain local, target lives elsewhere.
    assert(!shouldResolveMemberCall('relationSet', 'add', 'a/pool.mjs::McpClientPool.add', 'b/health.mjs'),
      'cross-file generic member call dropped');
  });

  await test('gate: non-generic method still resolves cross-file', () => {
    assert(shouldResolveMemberCall('pool', 'extractSymbols', 'a/pool.mjs::ParsePool.extractSymbols', 'b/idx.mjs'),
      'domain method kept');
  });

  await test('gate: this/self receiver always resolves', () => {
    assert(shouldResolveMemberCall('this', 'get', 'a/b.mjs::Cache.get', 'c/d.mjs'), 'this.get kept');
    assert(shouldResolveMemberCall('self', 'get', 'a/b.py::Cache.get', 'c/d.py'), 'self.get kept');
  });

  await test('gate: receiver naming the owning class resolves', () => {
    assert(shouldResolveMemberCall('parsePool', 'add', 'a/b.mjs::ParsePool.add', 'c/d.mjs'), 'instance of class kept');
    assert(shouldResolveMemberCall('ParsePool', 'add', 'a/b.mjs::ParsePool.add', 'c/d.mjs'), 'class itself kept');
  });

  await test('gate: same-file generic call resolves', () => {
    assert(shouldResolveMemberCall('cache', 'get', 'a/b.mjs::Cache.get', 'a/b.mjs'), 'same-file match kept');
  });

  await test('gate: vocabulary sets cover JS + Python + Java receivers', () => {
    for (const r of ['Set', 'console', 'os', 'json', 'System', 'Collections']) {
      assert(BUILTIN_RECEIVERS.has(r), `${r} listed as builtin receiver`);
    }
    for (const m of ['add', 'log', 'append', 'put', 'items']) {
      assert(GENERIC_MEMBER_METHODS.has(m), `${m} listed as generic member`);
    }
    // Domain-ish names must NOT be blocklisted — dropping those costs real edges.
    for (const m of ['run', 'init', 'close', 'save', 'load', 'validate']) {
      assert(!GENERIC_MEMBER_METHODS.has(m), `${m} must stay resolvable`);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════
// HEALTH v2 — relation suggestions, schema conformance, integrity
// ══════════════════════════════════════════════════════════════════════════

async function healthV2Tests() {
  console.log('\n🩺 Health v2 Tests');
  const {
    loadBrain, checkMissingRelations, checkSchemaConformance,
    checkDanglingRelations, checkRelationVocabulary, checkLowConfidence,
    checkStale, activeObservations, calculateHealth,
  } = await import('./lib/brain-health-checks.mjs');
  const { archiveRelationsFor, repointRelations } = await import('./lib/audit-trail.mjs');

  // ── Missing Relations: precision ──
  await test('health: generic shared words no longer suggest a relation', () => {
    const entities = [
      { name: 'BIZ:ProjectAlpha', entityType: 'biz-domain', observations: ['[0.8|2026-01-01] WHAT: biz platform 2026'] },
      { name: 'TECH:Person:MentorX', entityType: 'tech-person', observations: ['[0.8|2026-01-01] ROLE: biz advisor 2026'] },
    ];
    const r = checkMissingRelations(entities, []);
    assert(r.items.length === 0, `expected no suggestion, got ${JSON.stringify(r.items)}`);
  });

  await test('health: same-project entities sharing rare tokens are suggested', () => {
    const entities = [
      { name: 'PATTERN:WebCash:GridView', entityType: 'pattern-code', observations: ['[0.8|2026-01-01] WHAT: uses loaddatalist and calculateheight helpers'] },
      { name: 'PATTERN:WebCash:PageShell', entityType: 'pattern-arch', observations: ['[0.8|2026-01-01] WHAT: calls loaddatalist then calculateheight'] },
    ];
    const r = checkMissingRelations(entities, []);
    assert(r.items.length === 1, `expected 1 suggestion, got ${r.items.length}`);
    assert(r.items[0].confidence > 0, 'suggestion carries a confidence');
  });

  await test('health: existing relation is not re-suggested', () => {
    const entities = [
      { name: 'PATTERN:WebCash:GridView', entityType: 'pattern-code', observations: ['[0.8|2026-01-01] WHAT: uses loaddatalist and calculateheight helpers'] },
      { name: 'PATTERN:WebCash:PageShell', entityType: 'pattern-arch', observations: ['[0.8|2026-01-01] WHAT: calls loaddatalist then calculateheight'] },
    ];
    const rels = [{ from: 'PATTERN:WebCash:GridView', to: 'PATTERN:WebCash:PageShell', relationType: 'uses' }];
    assert(checkMissingRelations(entities, rels).items.length === 0, 'linked pair must not be suggested');
  });

  await test('health: Missing Relations is informational (weight 0)', () => {
    const r = checkMissingRelations([], []);
    assert(r.weight === 0 && r.informational === true, 'must not drag the score');
    assert(calculateHealth([r]) === 100, 'informational check contributes no penalty');
  });

  await test('health: relation suggestion scan is fast on 500 entities', () => {
    const entities = Array.from({ length: 500 }, (_, i) => ({
      name: `RULE:Proj${i % 10}:Rule${i}`,
      entityType: 'biz-rule',
      observations: [`[0.8|2026-01-01] RULE: rule ${i} about topic${i % 40} and widget${i % 37}`],
    }));
    const t = Date.now();
    checkMissingRelations(entities, []);
    const ms = Date.now() - t;
    assert(ms < 1500, `expected < 1500ms, took ${ms}ms`);
  });

  // ── Archived observation accounting ──
  await test('health: archived observations excluded from denominators', () => {
    const e = {
      name: 'BIZ:X', entityType: 'biz-domain',
      observations: [
        { content: '[0.8|2026-01-01] WHAT: live' },
        { content: '[0.8|2020-01-01] WHAT: superseded', _archived: true },
      ],
    };
    assert(activeObservations(e).length === 1, 'only live observations counted');
    assert(checkStale([e]).totalCount === 1, 'stale denominator excludes archived');
    assert(checkLowConfidence([e]).totalCount === 1, 'confidence denominator excludes archived');
  });

  // ── Schema conformance ──
  await test('health: schema flags wrong prefix, short observations, missing keys', () => {
    const bad = { name: 'PROJECT:Foo:Flow', entityType: 'biz-flow', observations: ['[0.8|2026-01-01] FLOW: a → b'] };
    const r = checkSchemaConformance([bad]);
    assert(r.violationCount === 1, 'entity flagged');
    const problems = r.items[0].problems.join(' | ');
    assert(/prefix/.test(problems), `prefix problem reported: ${problems}`);
    assert(/observations/.test(problems), `min-observation problem reported: ${problems}`);
    assert(/missing keys/.test(problems), `required keys reported: ${problems}`);
  });

  await test('health: conforming entity passes schema check', () => {
    const good = {
      name: 'GOTCHA:Foo:Thing', entityType: 'incident-gotcha',
      observations: [
        '[0.8|2026-01-01] WHAT: a thing',
        '[0.8|2026-01-01] IMPACT: breaks x',
        '[0.8|2026-01-01] FIX: do y',
        '[0.8|2026-01-01] APPLIES_TO: all',
      ],
    };
    assert(checkSchemaConformance([good]).violationCount === 0, 'clean entity not flagged');
  });

  // ── Dangling relations ──
  await test('health: dangling relations detect missing vs archived endpoints', () => {
    const entities = [{ name: 'BIZ:Alive', entityType: 'biz-domain', observations: [] }];
    const relations = [
      { from: 'BIZ:Alive', to: 'BIZ:Ghost', relationType: 'uses' },
      { from: 'BIZ:Alive', to: 'BIZ:Gone', relationType: 'uses' },
    ];
    const r = checkDanglingRelations(entities, relations, new Set(['BIZ:Gone']));
    assert(r.violationCount === 2, 'both flagged');
    assert(r.items.some(i => i.reasons.join().includes('does not exist')), 'missing endpoint reported');
    assert(r.items.some(i => i.reasons.join().includes('archived')), 'archived endpoint reported');
    assert(r.weight > 0, 'dangling relations count toward the score');
  });

  // ── Relation vocabulary ──
  await test('health: off-registry relation types reported, not deleted', () => {
    const r = checkRelationVocabulary([
      { from: 'a', to: 'b', relationType: 'uses' },
      { from: 'a', to: 'c', relationType: 'frobnicates' },
    ]);
    assert(r.violationCount === 1, 'only the off-registry one counted');
    assert(r.informational === true && r.weight === 0, 'informational, does not punish the score');
  });

  // ── Archive cascade ──
  await test('archive: cascades to relations touching the entity', () => {
    const relations = [
      { from: 'A', to: 'B', relationType: 'uses' },
      { from: 'C', to: 'D', relationType: 'uses' },
    ];
    assert(archiveRelationsFor(relations, ['B']) === 1, 'one relation archived');
    assert(relations[0]._archived === true, 'touching relation archived');
    assert(!relations[1]._archived, 'unrelated relation untouched');
  });

  await test('dedup: relations repoint to the surviving entity', () => {
    const relations = [{ from: 'X', to: 'OldName', relationType: 'uses' }];
    assert(repointRelations(relations, 'OldName', 'NewName') === 1, 'one relation repointed');
    assert(relations[0].to === 'NewName', 'edge follows the merged entity');
  });

  await test('dedup: repointing drops self-loops instead of creating them', () => {
    const relations = [{ from: 'Primary', to: 'Secondary', relationType: 'uses' }];
    repointRelations(relations, 'Secondary', 'Primary');
    assert(relations[0]._archived === true, 'self-loop archived rather than kept');
  });

  // ── Real graph regression ──
  await test('health: real brain graph passes all checks without throwing', () => {
    if (!existsSync(REAL_BRAIN)) { skipped++; return; }
    const { entities, relations, archivedNames } = loadBrain(REAL_BRAIN);
    const checks = [
      checkStale(entities), checkLowConfidence(entities),
      checkMissingRelations(entities, relations),
      checkSchemaConformance(entities),
      checkDanglingRelations(entities, relations, archivedNames),
      checkRelationVocabulary(relations),
    ];
    const score = calculateHealth(checks);
    assert(score >= 0 && score <= 100, `score in range, got ${score}`);
    const missing = checks[2];
    assert(missing.items.length <= 10, `at most 10 suggestions, got ${missing.items.length}`);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// MEMORY SEARCH SCORING + PROJECT-SCOPED RECALL
// ══════════════════════════════════════════════════════════════════════════

async function memorySearchScopingTests() {
  console.log('\n🔎 Memory Search Scoring + Scoped Recall Tests');
  const { tokenize, tokenizeQuery, scoreEntity, isIdentifierToken } =
    await import('./lib/memory-search-scoring.mjs');
  const { recallEntities, extractKeywords } = await import('./lib/session-recall.mjs');
  const id = (o) => o;

  const incident = {
    name: 'INCIDENT:InfoERP:ACPS10610000SaveMissingLoadingIndicator',
    entityType: 'incident-bug',
    observations: ['[0.9|2026-08-11] SYMPTOM: invoice save flow has no loading indicator'],
  };

  // ── tokenizing ──
  await test('scoring: identifier shapes detected', () => {
    assert(isIdentifierToken('ACPS10610000'), 'screen code is an identifier');
    assert(isIdentifierToken('btnVerify'), 'camelCase is an identifier');
    assert(isIdentifierToken('MEMB_SLIP_NO'), 'snake/upper is an identifier');
    assert(!isIdentifierToken('invoice'), 'plain word is not an identifier');
  });

  await test('scoring: stopwords dropped (English + Vietnamese)', () => {
    const t = tokenize('the invoice is in of và của với');
    assert(!t.has('the') && !t.has('in') && !t.has('of'), 'English stopwords dropped');
    assert(!t.has('và') && !t.has('của') && !t.has('với'), 'Vietnamese stopwords dropped');
    assert(t.has('invoice'), 'content word kept');
  });

  await test('scoring: glued entity names expand into parts', () => {
    const t = tokenize('ACPS10610000SaveMissingLoadingIndicator');
    assert(t.has('acps'), 'prefix part indexed');
    assert(t.has('10610000'), 'digit part indexed');
    assert(t.has('loading'), 'word part indexed');
  });

  // ── the actual regression: substring matching ──
  await test('scoring: short terms no longer substring-match (in/out/api)', () => {
    const { score } = scoreEntity(tokenizeQuery('in out api'), incident, id);
    assert(score === 0, `expected 0 for pure-noise query, got ${score}`);
  });

  await test('scoring: identifier query matches glued name', () => {
    const { score, matched } = scoreEntity(tokenizeQuery('ACPS10610000'), incident, id);
    assert(score > 0.5, `expected strong match, got ${score}`);
    assert(matched.includes('10610000'), 'reports which tokens matched');
  });

  await test('scoring: unrelated entity scores zero', () => {
    const wuxia = {
      name: 'BIZ:Wuxia', entityType: 'biz-domain',
      observations: ['[1|2026-01-01] Web novel generator'],
    };
    const { score } = scoreEntity(tokenizeQuery('ACPS10610000 invoice'), wuxia, id);
    assert(score === 0, `expected 0 for unrelated entity, got ${score}`);
  });

  // ── project scoping ──
  const scopedBrain = writeTempBrain('scoped.jsonl', [
    { name: 'BIZ:ProjAlpha', entityType: 'biz-domain', observations: ['[1|2026-01-01] alpha domain'] },
    { name: 'BIZ:ProjBeta', entityType: 'biz-domain', observations: ['[1|2026-01-01] beta domain uses kafka streaming'] },
    { name: 'INCIDENT:ProjAlpha:SaveBug', entityType: 'incident-bug', observations: ['[0.9|2026-01-01] SYMPTOM: invoice save crash'] },
    { name: 'INCIDENT:ProjBeta:SaveBug', entityType: 'incident-bug', observations: ['[0.9|2026-01-01] SYMPTOM: invoice save crash'] },
    { name: 'PATTERN:CODE:Retry', entityType: 'pattern-code', observations: ['[0.8|2026-01-01] WHAT: invoice retry pattern'] },
  ]);

  await test('recall: other projects excluded by default', () => {
    const r = recallEntities(scopedBrain, { cwd: '/work/projalpha', query: 'invoice save crash', maxResults: 10 });
    const names = r.entities.map(e => e.name);
    assert(names.some(n => n.includes('ProjAlpha')), 'own project present');
    assert(!names.some(n => n.includes('ProjBeta')), `other project leaked: ${names.join(', ')}`);
  });

  await test('recall: neutral (shared) entities stay visible', () => {
    const r = recallEntities(scopedBrain, { cwd: '/work/projalpha', query: 'invoice retry pattern', maxResults: 10 });
    assert(r.entities.some(e => e.name === 'PATTERN:CODE:Retry'), 'shared pattern must not be filtered out');
  });

  await test('recall: crossProject:true restores full breadth', () => {
    const r = recallEntities(scopedBrain, { cwd: '/work/projalpha', query: 'invoice save crash', maxResults: 10, crossProject: true });
    assert(r.entities.some(e => e.name.includes('ProjBeta')), 'opt-in cross-project returns other projects');
  });

  await test('recall: falls back to cross-project when nothing in scope', () => {
    // "kafka streaming" exists only on the other project — in-scope result set
    // is empty, so recall must widen rather than return nothing.
    const r = recallEntities(scopedBrain, { cwd: '/work/projalpha', query: 'kafka streaming', maxResults: 10 });
    assert(r.crossProjectFallback === true, 'fallback flag set');
    assert(r.entities.length > 0, 'fallback returns results rather than nothing');
  });

  await test('recall: Vietnamese filler words no longer become keywords', () => {
    const kw = extractKeywords('kết quả của việc này với các phần trong hệ thống');
    assert(!kw.includes('của') && !kw.includes('với') && !kw.includes('các'), `VN stopwords leaked: ${kw.join(',')}`);
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

  // ── Phase 04 round-2 patterns ──

  await test('laravel scanSource: route(\'name\') resolves to method via last segment', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'show', name: 'show', kind: 'method', file: 'app/Http/Controllers/UsersController.php', line: [10, 20], lang: 'php', parent: 'UsersController' },
    ]);
    const src = "return redirect()->route('users.show', $user);";
    const rels = laravelResolver.scanSource(src, 'app/Http/Controllers/Home.php', g);
    const routeRel = rels.find(r => r._meta?.resolvedBy === 'framework:laravel' && r.to === 'show');
    assert(routeRel, 'expected route() resolution');
    assert(routeRel._meta.confidence === 0.65, `expected 0.65 (lower than ::class), got ${routeRel._meta.confidence}`);
  });

  await test('laravel scanSource: view(\'blade.path\') resolves to blade.php component', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'v', name: 'profile', kind: 'component', file: 'resources/views/users/profile.blade.php', line: [1, 30], lang: 'liquid' },
    ]);
    const src = "return view('users.profile');";
    const rels = laravelResolver.scanSource(src, 'app/Http/Controllers/UserController.php', g);
    const viewRel = rels.find(r => r.kind === 'RENDERS');
    assert(viewRel, 'expected view() RENDERS edge');
    assert(viewRel.to === 'v');
  });

  await test('rails scanSource: resources :products → ProductsController class', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'cls', name: 'ProductsController', kind: 'class', file: 'app/controllers/products_controller.rb', line: [1, 50], lang: 'ruby' },
    ]);
    const src = "Rails.application.routes.draw do\n  resources :products\nend";
    const rels = railsResolver.scanSource(src, 'config/routes.rb', g);
    const rel = rels.find(r => r.to === 'cls');
    assert(rel, 'expected resources resolution');
    assert(rel._meta.confidence === 0.85);
  });

  await test('rails scanSource: Model.find_by_X dynamic finder records class usage', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'um', name: 'User', kind: 'class', file: 'app/models/user.rb', line: [1, 30], lang: 'ruby' },
      { id: 'enc', name: 'index', kind: 'method', file: 'app/controllers/users_controller.rb', line: [5, 15], lang: 'ruby', parent: 'UsersController' },
    ]);
    const src = "def index\n  @user = User.find_by_email(params[:email])\nend";
    const rels = railsResolver.scanSource(src, 'app/controllers/users_controller.rb', g);
    const rel = rels.find(r => r.to === 'um');
    assert(rel, 'expected find_by_ resolution to User class');
    assert(rel._meta.confidence === 0.7);
  });

  await test('django scanSource: Flask @app.route resolves handler function', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'h', name: 'login', kind: 'function', file: 'app/auth.py', line: [10, 20], lang: 'python', exported: true },
    ]);
    const src = "@app.route('/login', methods=['POST'])\ndef login():\n    pass";
    const rels = djangoResolver.scanSource(src, 'app/auth.py', g);
    assert(rels.length === 1, `expected 1 relation, got ${rels.length}`);
    assert(rels[0].to === 'h');
    assert(rels[0]._meta.confidence === 0.9);
  });

  await test('django scanSource: FastAPI @app.get resolves async handler', () => {
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'h', name: 'get_user', kind: 'function', file: 'app/api.py', line: [10, 20], lang: 'python', exported: true },
    ]);
    const src = "@app.get('/users/{id}')\nasync def get_user(id: int):\n    pass";
    const rels = djangoResolver.scanSource(src, 'app/api.py', g);
    assert(rels.length === 1);
    assert(rels[0].to === 'h');
  });

  // ── Phase 03 import-strategy ──

  await test('importStrategy: resolves via importMap to file in resolved module', async () => {
    const { importStrategy } = await import('../scripts/lib/code-intel/resolution/import-strategy.mjs');
    const g = new CodeGraph();
    g.addSymbols([
      { id: 'btnA', name: 'Button', kind: 'function', file: 'src/ui/Button.tsx', line: [5, 20], lang: 'tsx', exported: true },
      { id: 'btnB', name: 'Button', kind: 'function', file: 'src/legacy/Button.tsx', line: [3, 8], lang: 'tsx', exported: true },
    ]);
    const importMap = new Map();
    // ./ui/Button resolves from src/Page.tsx → src/ui/Button (finds src/ui/Button.tsx).
    importMap.set('src/Page.tsx', new Map([['Button', './ui/Button']]));
    const r = importStrategy.resolve(
      { sourceId: 'x', referenceName: 'Button', referenceKind: 'renders', fromFile: 'src/Page.tsx' },
      { graph: g, importMap }
    );
    assert(r, 'expected import resolution');
    assert(r.targetId === 'btnA', `expected btnA (imported), got ${r.targetId}`);
    assert(r.resolvedBy === 'import');
  });

  await test('importStrategy: returns null without importMap', async () => {
    const { importStrategy } = await import('../scripts/lib/code-intel/resolution/import-strategy.mjs');
    const g = new CodeGraph();
    const r = importStrategy.resolve(
      { sourceId: 'x', referenceName: 'X', referenceKind: 'calls', fromFile: 'a.ts' },
      { graph: g }
    );
    assert(r === null);
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
  await vueExtractorTests();
  await svelteExtractorTests();
  await liquidExtractorTests();
  await parsePoolTests();
  await phase01QuickWinsTests();
  await memorySearchScopingTests();
  await healthV2Tests();
  await memberCallGateTests();
  await sessionRecordTests();
  await doctorTests();
} finally {
  cleanup();
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed > 0 ? 1 : 0);
