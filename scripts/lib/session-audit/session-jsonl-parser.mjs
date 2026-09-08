/**
 * session-jsonl-parser.mjs — extract tool calls from agent session transcripts.
 *
 * Handles the Codex rollout JSONL shape (response_item envelopes carrying
 * function_call / function_call_output, plus the custom_tool_call variants).
 * Parses defensively: transcript formats differ per agent and change over time,
 * so unparseable lines are counted, never thrown.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { redactText } from '../redact-secrets.mjs';

/** Payload types that open a tool call. */
const CALL_TYPES = new Set(['function_call', 'custom_tool_call']);

/** Payload types that carry a tool result. */
const OUTPUT_TYPES = new Set(['function_call_output', 'custom_tool_call_output']);

/**
 * Failure markers. Kept high-precision and matched only near the START of the
 * output: a successful `hermit_session_start` echoes recalled observations,
 * and INCIDENT entities legitimately contain words like "timed out" or
 * "not indexed" — matching those anywhere flagged healthy calls as failures.
 */
const ERROR_MARKERS = [
  'Cannot read properties of',
  'is not a function',
  'is not defined',
  'ENOENT',
  'ECONNREFUSED',
  'Traceback (most recent call last)',
  'MCP error -',
  'Tool execution failed',
];

/** How far into the output an error marker still counts as the call's outcome. */
const ERROR_WINDOW = 300;

/**
 * Flatten a call_output payload into plain text. The output may be a plain
 * string, an array of content parts, or a JSON *string* holding such an array.
 * @param {object} payload
 * @returns {string}
 */
function outputText(payload) {
  const raw = payload.output;
  const fromParts = (arr) => arr.map(p => (typeof p === 'string' ? p : p?.text || '')).join('\n');
  if (Array.isArray(raw)) return fromParts(raw);
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return fromParts(parsed);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.content)) return fromParts(parsed.content);
        if (typeof parsed.text === 'string') return parsed.text;
      }
    } catch { /* not JSON — fall through to raw */ }
  }
  return raw;
}

/**
 * Does this output indicate the call failed?
 * @param {string} text - unwrapped output text
 * @returns {string|null} the matched marker, or null
 */
export function detectError(text) {
  if (!text) return null;
  const head = text.slice(0, ERROR_WINDOW);
  // Hermit's own fail() prefixes the message with "Error: ".
  if (/^\s*Error:/.test(text)) return 'Error:';
  for (const marker of ERROR_MARKERS) {
    if (head.includes(marker)) return marker;
  }
  return null;
}

/**
 * Normalize an error message into a fingerprint so the same fault groups
 * together regardless of paths, ids and numbers.
 * @param {string} text
 * @returns {string}
 */
export function errorFingerprint(text) {
  const line = String(text)
    .split('\n')
    .find(l => detectError(l)) || String(text).split('\n')[0] || '';
  return line
    .replace(/[A-Za-z]:[\\/][^\s'"]+/g, '<path>')
    .replace(/\/[^\s'"]{4,}/g, '<path>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hash>')
    .replace(/\b\d+\b/g, '<n>')
    .trim()
    .slice(0, 160);
}

/**
 * Parse an `mcp_tool_call_end` telemetry event.
 *
 * Shape:
 *   payload.invocation = { server, tool, arguments }
 *   payload.duration   = { secs, nanos }
 *   payload.result     = { Ok: { content: [{type,text}], isError } } | { Err: "..." }
 *
 * @param {object} rec - the enclosing JSONL record
 * @param {object} payload
 * @param {string} file
 * @param {string} [toolPrefix]
 * @returns {object|null}
 */
function parseMcpToolCallEnd(rec, payload, file, toolPrefix) {
  const tool = payload.invocation?.tool;
  if (!tool) return null;
  if (toolPrefix && !tool.startsWith(toolPrefix)) return null;

  const d = payload.duration;
  const durationMs = d && typeof d.secs === 'number'
    ? Math.round(d.secs * 1000 + (d.nanos || 0) / 1e6)
    : null;

  const result = payload.result || {};
  let ok = null;
  let errText = '';
  if (result.Err !== undefined) {
    ok = false;
    errText = typeof result.Err === 'string' ? result.Err : JSON.stringify(result.Err);
  } else if (result.Ok !== undefined) {
    ok = !result.Ok.isError;
    if (!ok) {
      const content = result.Ok.content;
      errText = Array.isArray(content)
        ? content.map(c => c?.text || '').join('\n')
        : String(result.Ok.content ?? '');
    }
  }

  // Redact before the text is retained anywhere.
  const safeErr = errText ? redactText(errText) : '';
  return {
    callId: payload.call_id || `${file}:${rec.timestamp}:${tool}`,
    tool,
    server: payload.invocation?.server || null,
    session: file,
    startedAt: rec.timestamp || null,
    endedAt: rec.timestamp || null,
    durationMs,
    ok,
    errorMarker: ok === false ? (detectError(safeErr) || 'reported-error') : null,
    fingerprint: ok === false ? errorFingerprint(safeErr) : null,
    source: 'mcp_tool_call_end',
  };
}

/**
 * Parse one transcript file into tool-call records.
 * @param {string} file
 * @param {object} [opts]
 * @param {string} [opts.toolPrefix] - only keep calls whose name starts with this
 * @returns {{ calls: object[], badLines: number }}
 */
export function parseSessionFile(file, opts = {}) {
  const { toolPrefix } = opts;
  let content;
  try { content = readFileSync(file, 'utf-8'); } catch { return { calls: [], badLines: 0 }; }

  const opened = new Map(); // call_id → partial record
  const calls = [];
  let badLines = 0;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { badLines++; continue; }
    const payload = rec?.payload;
    if (!payload?.type) continue;

    // Preferred source: the agent's own MCP telemetry. It carries the real
    // duration and an authoritative isError flag, so nothing has to be
    // inferred from output text.
    if (payload.type === 'mcp_tool_call_end') {
      const mcp = parseMcpToolCallEnd(rec, payload, file, toolPrefix);
      if (mcp) calls.push(mcp);
      continue;
    }

    if (CALL_TYPES.has(payload.type)) {
      const name = payload.name;
      if (!name) continue;
      if (toolPrefix && !name.startsWith(toolPrefix)) continue;
      const callId = payload.call_id || payload.id;
      if (!callId) continue;
      opened.set(callId, {
        callId, tool: name, session: file,
        startedAt: rec.timestamp || null,
      });
      continue;
    }

    if (OUTPUT_TYPES.has(payload.type)) {
      const callId = payload.call_id || payload.id;
      const open = callId && opened.get(callId);
      if (!open) continue;
      opened.delete(callId);
      // Redact BEFORE the text is retained anywhere.
      const text = redactText(outputText(payload));
      const marker = detectError(text);
      const endedAt = rec.timestamp || null;
      calls.push({
        ...open,
        endedAt,
        durationMs: open.startedAt && endedAt
          ? Math.max(0, Date.parse(endedAt) - Date.parse(open.startedAt))
          : null,
        ok: !marker,
        errorMarker: marker,
        fingerprint: marker ? errorFingerprint(text) : null,
      });
    }
  }

  // Calls with no output: the session ended mid-call (or the tool hung).
  for (const open of opened.values()) {
    calls.push({ ...open, endedAt: null, durationMs: null, ok: null, errorMarker: null, fingerprint: null });
  }

  return { calls, badLines };
}

/**
 * Recursively collect .jsonl transcripts under a root, newest-mtime first.
 * @param {string} root
 * @param {object} [opts]
 * @param {number} [opts.days] - only files modified within this many days
 * @returns {string[]}
 */
export function collectSessionFiles(root, opts = {}) {
  const cutoff = opts.days ? Date.now() - opts.days * 86400000 : 0;
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.jsonl')) continue;
      try {
        const st = statSync(p);
        if (cutoff && st.mtimeMs < cutoff) continue;
        out.push({ path: p, mtime: st.mtimeMs });
      } catch { /* unreadable */ }
    }
  };
  walk(root);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.map(f => f.path);
}
