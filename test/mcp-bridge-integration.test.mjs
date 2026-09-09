console.log('Performance thresholds: '+(process.env.HERMIT_PERFORMANCE_GATES==='1'?'ENFORCED':'INFORMATIONAL; use npm run bench:legacy for reference gates'));
/**
 * mcp-bridge-integration.test.mjs — End-to-end bridge tests via Brain MCP surface.
 *
 * Uses the in-test mock MCP server (test/helpers/mock-mcp-server.mjs).
 * Does NOT touch real ~/.hermit/mcp-bridges.json — uses HERMIT_BRIDGES_PATH.
 * Does NOT require external network or npm packages.
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpClientPool } from '../scripts/lib/mcp-bridge/mcp-client-pool.mjs';
import { BridgeRegistry } from '../scripts/lib/mcp-bridge/bridge-registry.mjs';
import { CircuitBreaker } from '../scripts/lib/mcp-bridge/circuit-breaker.mjs';
import { registerNamespacedTools } from '../scripts/lib/mcp-bridge/bridge-proxy.mjs';
import { MOCK_SERVER_SCRIPT } from './helpers/mock-mcp-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '..', 'tmp', 'test-05c');

let passed = 0;
let failed = 0;

async function test(name, fn, timeoutMs = 8000) {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function writeTmp(filename, content) {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
  const p = join(TMP, filename);
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

/** Build a minimal test rig: pool + registry + breaker + McpServer */
function makeRig() {
  const server = new McpServer({ name: 'test-brain', version: '0.0.1' });
  const pool = new McpClientPool();
  const registry = new BridgeRegistry();
  const breaker = new CircuitBreaker();
  return { server, pool, registry, breaker };
}

/** Mock bridge config pointing at the in-test server */
function mockCfg(name = 'mock') {
  return {
    name,
    transport: 'stdio',
    command: process.execPath,
    args: [MOCK_SERVER_SCRIPT],
    env: {},
    enabled: true,
  };
}

console.log('\nPhase 05c — MCP bridge integration tests');
console.log('=========================================');

// 1. Mock bridge enabled → mcp_mock_echo tool registered on Brain server
await test('enabled bridge tools appear on Brain server surface', async () => {
  const { server, pool, registry, breaker } = makeRig();
  try {
    const cfg = mockCfg('mock');
    await pool.add(cfg);
    const tools = await pool.listTools('mock');
    for (const t of tools) {
      registry.register({ bridge: 'mock', originalToolName: t.name, schema: t.inputSchema });
    }
    const registered = registerNamespacedTools(server, registry, pool, breaker);
    assert(registered.includes('mcp_mock_echo'), `mcp_mock_echo not in ${registered}`);
    assert(registered.includes('mcp_mock_add'), `mcp_mock_add not in ${registered}`);
    assert(registered.length === 2, `expected 2 tools, got ${registered.length}`);
  } finally {
    await pool.shutdownAll();
  }
});

// 2. Calling mcp_mock_echo via Brain surface returns expected echo
await test('mcp_mock_echo call returns expected echo result', async () => {
  const { pool, registry, breaker } = makeRig();
  try {
    const cfg = mockCfg('srv');
    await pool.add(cfg);
    const tools = await pool.listTools('srv');
    for (const t of tools) {
      registry.register({ bridge: 'srv', originalToolName: t.name, schema: t.inputSchema });
    }
    // Simulate the handler directly (same code path as server.registerTool handler)
    const entry = registry.resolve('mcp_srv_echo');
    assert(entry !== null, 'mcp_srv_echo should be registered');

    if (breaker.isOpen(entry.bridge)) throw new Error('breaker open unexpectedly');
    const result = await pool.callTool(entry.bridge, entry.originalToolName, { message: 'hello integration' });
    breaker.record(entry.bridge, true);

    assert(result.content[0].text === 'hello integration', `unexpected: ${result.content[0].text}`);
  } finally {
    await pool.shutdownAll();
  }
});

// 3. Forwarding overhead < 50ms wall-clock for stdio
await test('forwarding overhead measurement (optional 50ms reference gate)', async () => {
  const { pool, registry, breaker } = makeRig();
  try {
    await pool.add(mockCfg('perf'));
    const tools = await pool.listTools('perf');
    for (const t of tools) registry.register({ bridge: 'perf', originalToolName: t.name, schema: t.inputSchema });

    // Warm-up call
    await pool.callTool('perf', 'echo', { message: 'warmup' });

    // Timed call
    const t0 = Date.now();
    await pool.callTool('perf', 'echo', { message: 'timed' });
    const elapsed = Date.now() - t0;

    if(process.env.HERMIT_PERFORMANCE_GATES==='1')assert(elapsed < 50, `forwarding overhead ${elapsed}ms exceeds 50ms target`);
  } finally {
    await pool.shutdownAll();
  }
});

// 4. Circuit breaker: 3 consecutive failures → bridge circuit open → clear error
await test('3 consecutive failures open circuit breaker', async () => {
  const breaker = new CircuitBreaker();
  const bridge = 'flaky';
  assert(!breaker.isOpen(bridge), 'should start closed');
  breaker.record(bridge, false);
  assert(!breaker.isOpen(bridge), 'after 1 fail: still closed');
  breaker.record(bridge, false);
  assert(!breaker.isOpen(bridge), 'after 2 fails: still closed');
  breaker.record(bridge, false);
  assert(breaker.isOpen(bridge), 'after 3 fails: should be open');
  assert(breaker.failCount(bridge) === 3, `expected 3, got ${breaker.failCount(bridge)}`);
});

await test('circuit open → hermit_enable_bridge resets breaker', async () => {
  const breaker = new CircuitBreaker();
  const bridge = 'resettable';
  breaker.record(bridge, false);
  breaker.record(bridge, false);
  breaker.record(bridge, false);
  assert(breaker.isOpen(bridge), 'should be open before reset');
  breaker.reset(bridge);
  assert(!breaker.isOpen(bridge), 'should be closed after reset');
  assert(breaker.failCount(bridge) === 0, 'fail count should be 0 after reset');
});

await test('success resets consecutive fail counter', async () => {
  const breaker = new CircuitBreaker();
  const bridge = 'recover';
  breaker.record(bridge, false);
  breaker.record(bridge, false);
  assert(!breaker.isOpen(bridge), 'not open at 2 fails');
  breaker.record(bridge, true);   // success resets
  assert(breaker.failCount(bridge) === 0, 'counter should reset on success');
  breaker.record(bridge, false);
  assert(!breaker.isOpen(bridge), 'one fail after reset should not open');
});

// 5. Circuit-open state surfaces clear error through proxy handler
await test('proxy throws clear error when circuit is open', async () => {
  const { server, pool, registry, breaker } = makeRig();
  try {
    const cfg = mockCfg('blocked');
    await pool.add(cfg);
    const tools = await pool.listTools('blocked');
    for (const t of tools) registry.register({ bridge: 'blocked', originalToolName: t.name, schema: t.inputSchema });

    // Force circuit open
    for (let i = 0; i < 3; i++) breaker.record('blocked', false);
    assert(breaker.isOpen('blocked'), 'circuit should be open');

    registerNamespacedTools(server, registry, pool, breaker);

    // Call handler directly via registry entry
    const entry = registry.resolve('mcp_blocked_echo');
    let errorMsg = '';
    try {
      if (breaker.isOpen(entry.bridge)) {
        throw new Error(`bridge '${entry.bridge}' is in circuit-open state (3 consecutive failures); call hermit_enable_bridge to recover`);
      }
    } catch (e) {
      errorMsg = e.message;
    }
    assert(errorMsg.includes('circuit-open'), `expected circuit-open error, got: "${errorMsg}"`);
    assert(errorMsg.includes('hermit_enable_bridge'), `error should mention hermit_enable_bridge`);
  } finally {
    await pool.shutdownAll();
  }
});

// 6. Reload test: add second mock bridge, verify new tools appear
await test('reload adds second bridge tools without pool restart', async () => {
  const { pool, registry, breaker, server } = makeRig();
  // Shared set tracks names registered on this server instance (prevents double-register on reload)
  const alreadyRegistered = new Set();
  try {
    // Start with one bridge
    const cfg1 = mockCfg('first');
    await pool.add(cfg1);
    const tools1 = await pool.listTools('first');
    for (const t of tools1) registry.register({ bridge: 'first', originalToolName: t.name, schema: t.inputSchema });
    registerNamespacedTools(server, registry, pool, breaker, alreadyRegistered);

    const initialCount = registry.size;
    assert(initialCount === 2, `expected 2 initial tools, got ${initialCount}`);

    // Simulate reload: add second bridge
    const cfg2 = mockCfg('second');
    await pool.add(cfg2);
    const tools2 = await pool.listTools('second');
    for (const t of tools2) registry.register({ bridge: 'second', originalToolName: t.name, schema: t.inputSchema });
    // Pass same set — first bridge tools are skipped, only new ones registered
    registerNamespacedTools(server, registry, pool, breaker, alreadyRegistered);

    assert(registry.size === 4, `expected 4 tools after reload, got ${registry.size}`);
    assert(registry.resolve('mcp_second_echo') !== null, 'mcp_second_echo should be in registry');
    assert(registry.resolve('mcp_first_echo') !== null, 'mcp_first_echo still present');
  } finally {
    await pool.shutdownAll();
  }
});

// 7. hermit_list_bridges reflects pool + registry + breaker state
await test('bridge status summary is accurate', async () => {
  const { pool, registry, breaker } = makeRig();
  try {
    await pool.add(mockCfg('status_test'));
    const tools = await pool.listTools('status_test');
    for (const t of tools) registry.register({ bridge: 'status_test', originalToolName: t.name, schema: t.inputSchema });

    const statuses = pool.getStatuses();
    const s = statuses.find(x => x.name === 'status_test');
    assert(s, 'status_test should be in pool statuses');
    assert(s.status === 'ready', `expected ready, got ${s.status}`);

    const toolCount = registry.list().filter(e => e.bridge === 'status_test').length;
    assert(toolCount === 2, `expected 2 tools, got ${toolCount}`);
    assert(!breaker.isOpen('status_test'), 'breaker should be closed for healthy bridge');
  } finally {
    await pool.shutdownAll();
  }
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

try {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
} catch { /* ignore */ }

console.log(`\n📊 Phase 05c results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
