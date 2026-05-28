/**
 * trace-schema.mjs — Frozen v1 trace event schema for Hermit skill-evolution bus.
 *
 * Schema is API: once consumed by external subscribers, breaking changes require
 * a version bump via TRACE_SCHEMA_VERSION.
 *
 * Privacy: events MAY contain query text, file paths, tool args.
 * Only emit when HERMIT_TRACE_BUS=1 (opt-in).
 *
 * @module trace-schema
 */

/** Frozen schema version. Bump on any breaking field change. */
export const TRACE_SCHEMA_VERSION = 1;

/**
 * Valid event type identifiers (frozen v1 set).
 * @readonly
 */
export const EVENT_TYPES = Object.freeze([
  'tool:call',
  'tool:result',
  'search:query',
  'search:fusion',
  'bridge:forward',
]);

// ── Type definitions (JSDoc / TypeScript-style) ──

/**
 * @typedef {object} ToolCallEvent
 * @property {'tool:call'} type
 * @property {string} tool - MCP tool name (e.g. 'hermit_search_nodes')
 * @property {object} args - Raw tool arguments
 * @property {number} ts - Unix timestamp ms (Date.now())
 * @property {number} schemaVersion - Always TRACE_SCHEMA_VERSION
 */

/**
 * @typedef {object} ToolResultEvent
 * @property {'tool:result'} type
 * @property {string} tool - MCP tool name
 * @property {number} durationMs - Wall-clock ms from call to result
 * @property {boolean} success - False if the handler threw or returned isError
 * @property {string} [error] - Error message string (only when success=false)
 * @property {number} ts
 * @property {number} schemaVersion
 */

/**
 * @typedef {object} SearchQueryEvent
 * @property {'search:query'} type
 * @property {string} query - User search string
 * @property {'bm25'|'vector'|'hybrid'} mode - Retrieval mode used
 * @property {number} resultCount - Items returned
 * @property {number} ts
 * @property {number} schemaVersion
 */

/**
 * @typedef {object} RankEntry
 * @property {string} name
 * @property {number} rank
 */

/**
 * @typedef {object} FusedEntry
 * @property {string} name
 * @property {number} score
 */

/**
 * @typedef {object} SearchFusionEvent
 * @property {'search:fusion'} type
 * @property {RankEntry[][]} rankings - Per-ranker ranked lists (index 0=bm25, 1=vector)
 * @property {FusedEntry[]} fused - RRF-fused result list
 * @property {number} ts
 * @property {number} schemaVersion
 */

/**
 * @typedef {object} BridgeForwardEvent
 * @property {'bridge:forward'} type
 * @property {string} bridge - Bridge name (e.g. 'filesystem')
 * @property {string} tool - Original tool name on the remote bridge
 * @property {number} durationMs
 * @property {boolean} success
 * @property {number} ts
 * @property {number} schemaVersion
 */

/**
 * @typedef {ToolCallEvent|ToolResultEvent|SearchQueryEvent|SearchFusionEvent|BridgeForwardEvent} TraceEvent
 */

// ── Runtime validators ──

/**
 * @param {unknown} evt
 * @returns {void}
 * @throws {TypeError}
 */
export function validateToolCall(evt) {
  if (typeof evt.tool !== 'string' || !evt.tool) throw new TypeError('tool:call requires string tool');
  if (typeof evt.args !== 'object' || evt.args === null) throw new TypeError('tool:call requires object args');
  if (typeof evt.ts !== 'number') throw new TypeError('tool:call requires number ts');
}

/**
 * @param {unknown} evt
 * @returns {void}
 * @throws {TypeError}
 */
export function validateToolResult(evt) {
  if (typeof evt.tool !== 'string' || !evt.tool) throw new TypeError('tool:result requires string tool');
  if (typeof evt.durationMs !== 'number') throw new TypeError('tool:result requires number durationMs');
  if (typeof evt.success !== 'boolean') throw new TypeError('tool:result requires boolean success');
  if (!evt.success && evt.error !== undefined && typeof evt.error !== 'string') {
    throw new TypeError('tool:result error must be string when present');
  }
  if (typeof evt.ts !== 'number') throw new TypeError('tool:result requires number ts');
}

/**
 * @param {unknown} evt
 * @returns {void}
 * @throws {TypeError}
 */
export function validateSearchQuery(evt) {
  if (typeof evt.query !== 'string' || !evt.query) throw new TypeError('search:query requires string query');
  if (!['bm25', 'vector', 'hybrid'].includes(evt.mode)) throw new TypeError('search:query mode must be bm25|vector|hybrid');
  if (typeof evt.resultCount !== 'number') throw new TypeError('search:query requires number resultCount');
  if (typeof evt.ts !== 'number') throw new TypeError('search:query requires number ts');
}

/**
 * @param {unknown} evt
 * @returns {void}
 * @throws {TypeError}
 */
export function validateSearchFusion(evt) {
  if (!Array.isArray(evt.rankings)) throw new TypeError('search:fusion requires Array rankings');
  if (!Array.isArray(evt.fused)) throw new TypeError('search:fusion requires Array fused');
  if (typeof evt.ts !== 'number') throw new TypeError('search:fusion requires number ts');
}

/**
 * @param {unknown} evt
 * @returns {void}
 * @throws {TypeError}
 */
export function validateBridgeForward(evt) {
  if (typeof evt.bridge !== 'string' || !evt.bridge) throw new TypeError('bridge:forward requires string bridge');
  if (typeof evt.tool !== 'string' || !evt.tool) throw new TypeError('bridge:forward requires string tool');
  if (typeof evt.durationMs !== 'number') throw new TypeError('bridge:forward requires number durationMs');
  if (typeof evt.success !== 'boolean') throw new TypeError('bridge:forward requires boolean success');
  if (typeof evt.ts !== 'number') throw new TypeError('bridge:forward requires number ts');
}

/**
 * Master dispatcher — validates any TraceEvent by type.
 *
 * @param {TraceEvent} evt
 * @returns {void}
 * @throws {TypeError} if event is invalid
 */
export function validateEvent(evt) {
  if (!evt || typeof evt !== 'object') throw new TypeError('Event must be an object');
  if (!EVENT_TYPES.includes(evt.type)) {
    throw new TypeError(`Unknown event type: ${evt.type}. Valid: ${EVENT_TYPES.join(', ')}`);
  }
  switch (evt.type) {
    case 'tool:call':      return validateToolCall(evt);
    case 'tool:result':    return validateToolResult(evt);
    case 'search:query':   return validateSearchQuery(evt);
    case 'search:fusion':  return validateSearchFusion(evt);
    case 'bridge:forward': return validateBridgeForward(evt);
  }
}
