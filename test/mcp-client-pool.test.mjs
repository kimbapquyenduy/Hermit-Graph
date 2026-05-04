/**
 * mcp-client-pool.test.mjs — Tests for McpClientPool + transport-factory.
 *
 * Uses in-test mock MCP server (test/helpers/mock-mcp-server.mjs).
 * No external network or npm packages required.
 */

import { McpClientPool } from '../scripts/lib/mcp-bridge/mcp-client-pool.mjs';
import { MOCK_SERVER_SCRIPT } from './helpers/mock-mcp-server.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn, timeoutMs = 8000) {
  const timer = setTimeout(() => {}, timeoutMs); // keep event loop alive
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
  } finally {
    clearTimeout(timer);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

/** Bridge config pointing at the mock server */
function mockBridgeConfig(name = 'mock') {
  return {
    name,
    transport: 'stdio',
    command: process.execPath, // node
    args: [MOCK_SERVER_SCRIPT],
    env: {},
  };
}

// ── Test Suite ───────────────────────────────────────────────────────────────

console.log('\nPhase 05a — McpClientPool tests');
console.log('================================');

// 1. Pool spawns, lists tools, calls tool successfully
await test('pool spawns and lists tools', async () => {
  const pool = new McpClientPool();
  try {
    await pool.add(mockBridgeConfig('t1'));
    const tools = await pool.listTools('t1');
    assert(Array.isArray(tools), 'tools should be array');
    assert(tools.length >= 2, `expected >= 2 tools, got ${tools.length}`);
    const names = tools.map(t => t.name);
    assert(names.includes('echo'), 'echo tool missing');
    assert(names.includes('add'), 'add tool missing');
  } finally {
    await pool.shutdownAll();
  }
});

await test('pool calls echo tool successfully', async () => {
  const pool = new McpClientPool();
  try {
    await pool.add(mockBridgeConfig('t2'));
    const result = await pool.callTool('t2', 'echo', { message: 'hello bridge' });
    assert(result, 'result should be truthy');
    const text = result.content?.[0]?.text;
    assert(text === 'hello bridge', `expected "hello bridge", got "${text}"`);
  } finally {
    await pool.shutdownAll();
  }
});

await test('pool calls add tool successfully', async () => {
  const pool = new McpClientPool();
  try {
    await pool.add(mockBridgeConfig('t3'));
    const result = await pool.callTool('t3', 'add', { a: 3, b: 7 });
    const text = result.content?.[0]?.text;
    assert(text === '10', `expected "10", got "${text}"`);
  } finally {
    await pool.shutdownAll();
  }
});

await test('tools are cached (60s TTL)', async () => {
  const pool = new McpClientPool();
  try {
    await pool.add(mockBridgeConfig('t4'));
    const t1 = await pool.listTools('t4');
    const t2 = await pool.listTools('t4');
    assert(t1 === t2, 'second call should return same array reference (cached)');
  } finally {
    await pool.shutdownAll();
  }
});

await test('duplicate add throws', async () => {
  const pool = new McpClientPool();
  try {
    await pool.add(mockBridgeConfig('dup'));
    let threw = false;
    try {
      await pool.add(mockBridgeConfig('dup'));
    } catch {
      threw = true;
    }
    assert(threw, 'should throw on duplicate name');
  } finally {
    await pool.shutdownAll();
  }
});

// 2. Multiple bridges in parallel — independent operation
await test('two bridges work independently in parallel', async () => {
  const pool = new McpClientPool();
  try {
    await Promise.all([
      pool.add(mockBridgeConfig('bridge_a')),
      pool.add(mockBridgeConfig('bridge_b')),
    ]);
    const [ra, rb] = await Promise.all([
      pool.callTool('bridge_a', 'echo', { message: 'from_a' }),
      pool.callTool('bridge_b', 'echo', { message: 'from_b' }),
    ]);
    assert(ra.content[0].text === 'from_a', `bridge_a: got "${ra.content[0].text}"`);
    assert(rb.content[0].text === 'from_b', `bridge_b: got "${rb.content[0].text}"`);
  } finally {
    await pool.shutdownAll();
  }
});

// 3. Subprocess crash → 3 restarts → dead
await test('crash triggers restarts and eventually marks bridge dead', async () => {
  const pool = new McpClientPool();
  const name = 'crasher';
  // Use a command that exits immediately (simulates crash)
  await pool.add({
    name,
    transport: 'stdio',
    command: process.execPath,
    args: ['--eval', 'process.exit(1)'],
    env: {},
  });

  // Wait enough for 3 restarts (1+2+4 = 7s total backoff) + buffer
  await new Promise(r => setTimeout(r, 9000));

  const statuses = pool.getStatuses();
  const s = statuses.find(x => x.name === name);
  assert(s, 'bridge state should exist');
  assert(s.status === 'dead', `expected dead, got ${s.status}`);
  assert(s.restartAttempts === 3, `expected 3 attempts, got ${s.restartAttempts}`);

  await pool.shutdownAll();
}, 12000);

// 4. One bridge crashing doesn't affect another
await test('one bridge crash does not affect sibling bridge', async () => {
  const pool = new McpClientPool();
  try {
    await Promise.all([
      pool.add({
        name: 'good',
        transport: 'stdio',
        command: process.execPath,
        args: [MOCK_SERVER_SCRIPT],
        env: {},
      }),
      pool.add({
        name: 'bad',
        transport: 'stdio',
        command: process.execPath,
        args: ['--eval', 'process.exit(1)'],
        env: {},
      }),
    ]);

    // Good bridge should still work regardless
    const result = await pool.callTool('good', 'echo', { message: 'still alive' });
    assert(result.content[0].text === 'still alive', 'sibling should still work');
  } finally {
    await pool.shutdownAll();
  }
});

// 5. SIGINT propagation: shutdownAll completes within 2s
await test('shutdownAll completes within 2s', async () => {
  const pool = new McpClientPool();
  await Promise.all([
    pool.add(mockBridgeConfig('sd_a')),
    pool.add(mockBridgeConfig('sd_b')),
  ]);
  const start = Date.now();
  await pool.shutdownAll();
  const elapsed = Date.now() - start;
  assert(elapsed < 2000, `shutdownAll took ${elapsed}ms, expected < 2000ms`);
  // Verify bridges are gone
  assert(pool.getStatuses().length === 0, 'all bridges should be removed');
});

// 6. remove() by name
await test('remove() closes a single bridge', async () => {
  const pool = new McpClientPool();
  await pool.add(mockBridgeConfig('removable'));
  await pool.remove('removable');
  let threw = false;
  try {
    await pool.callTool('removable', 'echo', { message: 'x' });
  } catch {
    threw = true;
  }
  assert(threw, 'callTool after remove should throw');
  await pool.shutdownAll(); // no-op
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n📊 Phase 05a results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
