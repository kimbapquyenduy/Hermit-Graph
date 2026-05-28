# Skill Evolution Trace Schema — v1 (Frozen)

> **Schema version:** `TRACE_SCHEMA_VERSION = 1`
>
> This schema is API. Once external consumers exist, breaking field changes require a version bump. Additive changes (new optional fields) are allowed without a version bump.

## Overview

The trace bus emits structured events at key execution points in Hermit Brain. Events are captured in a bounded ring buffer (last 1000) and optionally written to a JSONL file sink. The bus is **opt-in** — disabled by default.

## Privacy Notice

**LOUD WARNING:** Trace events MAY contain sensitive user data:
- Query text (search queries you type)
- Tool arguments (entity names, file paths, observation content)
- File paths from your working directory

**Default is OFF.** You must explicitly set `HERMIT_TRACE_BUS=1` to enable. Do not enable in shared/CI environments without understanding what is captured.

## How to Enable

```bash
# Enable in-memory ring buffer only (no disk write)
HERMIT_TRACE_BUS=1 node hermit-mcp-server.mjs

# Enable + write to file sink
HERMIT_TRACE_BUS=1 HERMIT_TRACE_SINK=/tmp/hermit-traces.jsonl node hermit-mcp-server.mjs
```

Then inspect recent events via the MCP tool:
```json
{ "name": "hermit_tap_traces", "arguments": { "n": 50 } }
```

## File Sink Notes

- Format: append-only JSONL (one JSON object per line)
- Each line is a complete, independently parseable `TraceEvent`
- File is opened with `flags: 'a'` — safe to restart the server without truncating
- `HERMIT_TRACE_SINK` must point to a writable path; errors are logged to stderr (non-fatal)
- No rotation policy is implemented — monitor disk usage manually
- **Never** points to a default path; `HERMIT_TRACE_SINK` must be set explicitly

## Event Schema (TypeScript notation)

```typescript
type TraceEvent =
  | ToolCallEvent
  | ToolResultEvent
  | SearchQueryEvent
  | SearchFusionEvent
  | BridgeForwardEvent;

// Common fields on all events
interface BaseEvent {
  ts: number;              // Unix timestamp ms (Date.now())
  schemaVersion: 1;        // Always 1 for v1 schema
}

interface ToolCallEvent extends BaseEvent {
  type: 'tool:call';
  tool: string;            // MCP tool name (e.g. 'hermit_search_nodes')
  args: object;            // Raw tool arguments passed by the caller
}

interface ToolResultEvent extends BaseEvent {
  type: 'tool:result';
  tool: string;            // Same tool name as the preceding tool:call
  durationMs: number;      // Wall-clock ms from call start to result
  success: boolean;        // false if handler threw or returned isError: true
  error?: string;          // Error message string (only present when success=false)
}

interface SearchQueryEvent extends BaseEvent {
  type: 'search:query';
  query: string;           // User search string
  mode: 'bm25' | 'vector' | 'hybrid';  // Retrieval mode used
  resultCount: number;     // Number of results returned
}

interface SearchFusionEvent extends BaseEvent {
  type: 'search:fusion';
  rankings: Array<Array<{ name: string; rank: number }>>;
  // rankings[0] = BM25 ranked list, rankings[1] = vector ranked list
  // rank is 1-indexed position in each ranker's output
  fused: Array<{ name: string; score: number }>;
  // RRF-fused result list, sorted by score descending
}

interface BridgeForwardEvent extends BaseEvent {
  type: 'bridge:forward';
  bridge: string;          // Bridge name (e.g. 'filesystem', 'git')
  tool: string;            // Original tool name on the remote bridge
  durationMs: number;      // Round-trip time for the forwarded call
  success: boolean;        // false if pool.callTool threw
}
```

## Sample Events (JSONL)

```jsonl
{"type":"tool:call","tool":"hermit_search_nodes","args":{"query":"payment","limit":10},"ts":1746400000000,"schemaVersion":1}
{"type":"tool:result","tool":"hermit_search_nodes","durationMs":4,"success":true,"ts":1746400000004,"schemaVersion":1}
{"type":"search:query","query":"payment gateway","mode":"hybrid","resultCount":7,"ts":1746400000010,"schemaVersion":1}
{"type":"search:fusion","rankings":[[{"name":"RULE:Shop:PaymentGateway","rank":1}],[{"name":"RULE:Shop:PaymentGateway","rank":2}]],"fused":[{"name":"RULE:Shop:PaymentGateway","score":0.9836}],"ts":1746400000012,"schemaVersion":1}
{"type":"bridge:forward","bridge":"filesystem","tool":"read_file","durationMs":11,"success":true,"ts":1746400000020,"schemaVersion":1}
```

## Tap Points (5 wired in v1)

| Event | Module | When |
|-------|--------|------|
| `tool:call` + `tool:result` | `memory-module.mjs` | Around every memory tool handler |
| `tool:call` + `tool:result` | `codegraph-module.mjs` | Around every codegraph tool handler |
| `search:query` | `unified-search.mjs` | After `hermit_unified_search` completes |
| `search:fusion` | `memory/hybrid-retrieval.mjs` | After RRF fuses BM25 + vector rankings |
| `bridge:forward` | `mcp-bridge/bridge-proxy.mjs` | After each proxied bridge call |

## Ring Buffer

- Capacity: 1000 events (configurable via `TraceEmitter` constructor `ringSize`)
- When full: oldest event is dropped on push (FIFO eviction)
- Inspect via `hermit_tap_traces` MCP tool (returns last N, max 1000)

## Future Work (NOT implemented)

The trace bus is wiring only. These are explicitly out of scope for v1:

- DSPy integration for prompt auto-tuning
- GEPA-style trace-driven evolution
- Mutation/training/scoring logic of any kind
- Redaction filters for sensitive fields
- Log rotation policy for file sink

Future phases (Phase 8+) may attach external consumers to `ctx.traceBus` as a standard Node `EventEmitter`.
