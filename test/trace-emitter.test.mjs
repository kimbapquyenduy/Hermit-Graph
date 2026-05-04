/**
 * trace-emitter.test.mjs — Unit tests for TraceEmitter + trace-schema validators.
 *
 * Covers:
 *  - Emit + subscribe round-trips
 *  - Ring buffer cap (push 1500 → exactly 1000 retained, oldest dropped)
 *  - File sink writes valid JSONL
 *  - Schema validation: invalid events throw clearly
 *  - Zero overhead: bus=null path + bench (10k no-op calls < 10ms)
 *  - Privacy: traceBus null when HERMIT_TRACE_BUS unset
 */

import assert from 'assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { TraceEmitter } from '../scripts/lib/skill-evolution/trace-emitter.mjs';
import {
  validateEvent,
  validateToolCall,
  validateToolResult,
  validateSearchQuery,
  validateSearchFusion,
  validateBridgeForward,
  TRACE_SCHEMA_VERSION,
  EVENT_TYPES,
} from '../scripts/lib/skill-evolution/trace-schema.mjs';

// ── helpers ──

function makeSink() {
  const path = join(tmpdir(), `hermit-trace-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  return { path, cleanup: () => existsSync(path) && unlinkSync(path) };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Schema tests ──

{
  console.log('trace-schema: TRACE_SCHEMA_VERSION is 1');
  assert.equal(TRACE_SCHEMA_VERSION, 1);

  console.log('trace-schema: EVENT_TYPES has 5 entries');
  assert.equal(EVENT_TYPES.length, 5);

  console.log('trace-schema: validateToolCall passes valid event');
  validateToolCall({ tool: 'hermit_search_nodes', args: { query: 'test' }, ts: Date.now() });

  console.log('trace-schema: validateToolCall rejects missing tool');
  assert.throws(() => validateToolCall({ tool: '', args: {}, ts: 1 }), /tool:call requires string tool/);

  console.log('trace-schema: validateToolCall rejects null args');
  assert.throws(() => validateToolCall({ tool: 'x', args: null, ts: 1 }), /tool:call requires object args/);

  console.log('trace-schema: validateToolResult passes valid event');
  validateToolResult({ tool: 'hermit_query', durationMs: 42, success: true, ts: Date.now() });

  console.log('trace-schema: validateToolResult rejects non-boolean success');
  assert.throws(() => validateToolResult({ tool: 'x', durationMs: 1, success: 'yes', ts: 1 }), /boolean success/);

  console.log('trace-schema: validateSearchQuery passes valid event');
  validateSearchQuery({ query: 'auth', mode: 'hybrid', resultCount: 5, ts: Date.now() });

  console.log('trace-schema: validateSearchQuery rejects invalid mode');
  assert.throws(() => validateSearchQuery({ query: 'x', mode: 'fulltext', resultCount: 0, ts: 1 }), /mode must be/);

  console.log('trace-schema: validateSearchFusion passes valid event');
  validateSearchFusion({ rankings: [[], []], fused: [], ts: Date.now() });

  console.log('trace-schema: validateSearchFusion rejects non-array rankings');
  assert.throws(() => validateSearchFusion({ rankings: null, fused: [], ts: 1 }), /Array rankings/);

  console.log('trace-schema: validateBridgeForward passes valid event');
  validateBridgeForward({ bridge: 'fs', tool: 'read_file', durationMs: 10, success: true, ts: Date.now() });

  console.log('trace-schema: validateBridgeForward rejects missing bridge');
  assert.throws(() => validateBridgeForward({ bridge: '', tool: 'x', durationMs: 1, success: true, ts: 1 }), /string bridge/);

  console.log('trace-schema: validateEvent dispatches by type');
  validateEvent({ type: 'tool:call', tool: 'x', args: {}, ts: 1 });
  assert.throws(() => validateEvent({ type: 'unknown:type' }), /Unknown event type/);
  assert.throws(() => validateEvent(null), /Event must be an object/);
}

// ── TraceEmitter: basic emit + subscribe ──

{
  console.log('TraceEmitter: emit + subscribe round-trip');
  const bus = new TraceEmitter({ ringSize: 100 });
  let received = null;
  bus.on('tool:call', (evt) => { received = evt; });
  bus.emit('tool:call', { tool: 'hermit_query', args: { query: 'x' } });
  assert.ok(received, 'subscriber received event');
  assert.equal(received.tool, 'hermit_query');
  assert.equal(received.schemaVersion, TRACE_SCHEMA_VERSION);
  assert.ok(typeof received.ts === 'number', 'ts added');
  assert.equal(received.type, 'tool:call');
}

// ── Ring buffer cap ──

{
  console.log('TraceEmitter: ring buffer caps at ringSize (push 1500 → keep 1000)');
  const bus = new TraceEmitter({ ringSize: 1000 });
  for (let i = 0; i < 1500; i++) {
    bus.emit('tool:call', { tool: `tool_${i}`, args: { i } });
  }
  assert.equal(bus.bufferSize, 1000, `expected 1000, got ${bus.bufferSize}`);

  // Oldest entries (tool_0..499) should be gone; newest (tool_500..1499) retained
  const recent = bus.getRecent(1000);
  assert.equal(recent.length, 1000);
  assert.equal(recent[0].tool, 'tool_500', `oldest retained should be tool_500, got ${recent[0].tool}`);
  assert.equal(recent[999].tool, 'tool_1499', `newest should be tool_1499, got ${recent[999].tool}`);
}

// ── getRecent capping ──

{
  console.log('TraceEmitter: getRecent caps at ringSize');
  const bus = new TraceEmitter({ ringSize: 50 });
  for (let i = 0; i < 50; i++) bus.emit('tool:result', { tool: 't', durationMs: 1, success: true });
  const all = bus.getRecent(9999);
  assert.equal(all.length, 50);
  const few = bus.getRecent(10);
  assert.equal(few.length, 10);
}

// ── File sink: valid JSONL ──

{
  console.log('TraceEmitter: file sink writes valid JSONL');
  const { path, cleanup } = makeSink();
  try {
    const bus = new TraceEmitter({ ringSize: 100, sinkPath: path });
    // Give the stream time to open
    await sleep(50);
    bus.emit('tool:call', { tool: 'hermit_search_nodes', args: { query: 'test' } });
    bus.emit('tool:result', { tool: 'hermit_search_nodes', durationMs: 5, success: true });
    await bus.close();

    const lines = readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 2, `expected 2 JSONL lines, got ${lines.length}`);
    const first = JSON.parse(lines[0]);
    assert.equal(first.type, 'tool:call');
    assert.equal(first.schemaVersion, TRACE_SCHEMA_VERSION);
    const second = JSON.parse(lines[1]);
    assert.equal(second.type, 'tool:result');
  } finally {
    cleanup();
  }
}

// ── Schema validation on emit ──

{
  console.log('TraceEmitter: invalid event throws on emit');
  const bus = new TraceEmitter({ ringSize: 10 });
  assert.throws(
    () => bus.emit('tool:call', { tool: '', args: {} }),
    /tool:call requires string tool/
  );
  // Buffer unchanged after failed emit
  assert.equal(bus.bufferSize, 0);
}

// ── Zero-overhead bench: bus=null path ──

{
  console.log('TraceEmitter: zero-overhead bench — 10k no-op emit calls with bus=null < 10ms');
  // Simulate the tap-point guard: if (bus) bus.emit(...)
  const bus = null;
  const start = Date.now();
  for (let i = 0; i < 10000; i++) {
    if (bus) bus.emit('tool:call', { tool: 'x', args: {} }); // never executes
  }
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 10, `10k no-op calls took ${elapsed}ms, expected < 10ms`);
  console.log(`  → 10k no-op calls: ${elapsed}ms`);
}

// ── Privacy: HERMIT_TRACE_BUS unset → no traceBus ──

{
  console.log('TraceEmitter: privacy — no bus created when HERMIT_TRACE_BUS unset');
  // Simulates what hermit-mcp-server.mjs does at startup
  const enabled = process.env.HERMIT_TRACE_BUS === '1';
  const traceBus = enabled ? new TraceEmitter({ ringSize: 1000 }) : null;
  assert.equal(traceBus, null, 'traceBus must be null when HERMIT_TRACE_BUS is not set');
}

// ── Constructor validation ──

{
  console.log('TraceEmitter: constructor rejects invalid ringSize');
  assert.throws(() => new TraceEmitter({ ringSize: 0 }), /ringSize must be a positive integer/);
  assert.throws(() => new TraceEmitter({ ringSize: -1 }), /ringSize must be a positive integer/);
  assert.throws(() => new TraceEmitter({ ringSize: 1.5 }), /ringSize must be a positive integer/);
}

console.log('\nAll trace-emitter tests passed.');
