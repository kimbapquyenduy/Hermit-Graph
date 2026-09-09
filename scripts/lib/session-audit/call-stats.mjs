/**
 * call-stats.mjs — aggregate parsed tool calls into per-tool health stats.
 *
 * Dedup by call_id is mandatory: a retried or re-emitted call otherwise
 * double-counts and inflates both volume and error rate.
 */

/**
 * @param {number[]} sorted - ascending
 * @param {number} p - 0..1
 * @returns {number|null}
 */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Deduplicate calls by call_id, keeping the first complete record seen.
 * @param {object[]} calls
 * @returns {object[]}
 */
export function dedupeByCallId(calls) {
  const byId = new Map();
  // Higher wins. MCP telemetry carries a real duration and an authoritative
  // isError flag, so it beats a record inferred from output text; any record
  // with an outcome beats a dangling one.
  const rank = (c) => (c.source === 'mcp_tool_call_end' ? 2 : 0) + (c.ok !== null ? 1 : 0);
  for (const c of calls) {
    const existing = byId.get(c.callId);
    if (!existing || rank(c) > rank(existing)) byId.set(c.callId, c);
  }
  return [...byId.values()];
}

/**
 * Build per-tool and overall statistics.
 * @param {object[]} rawCalls
 * @returns {object}
 */
export function summarize(rawCalls) {
  const calls = dedupeByCallId(rawCalls);
  const tools = new Map();
  const fingerprints = new Map();

  for (const c of calls) {
    if (!tools.has(c.tool)) {
      tools.set(c.tool, { tool: c.tool, total: 0, errors: 0, incomplete: 0, durations: [] });
    }
    const t = tools.get(c.tool);
    t.total++;
    if (c.ok === false) t.errors++;
    if (c.ok === null) t.incomplete++;
    if (typeof c.durationMs === 'number') t.durations.push(c.durationMs);

    if (c.fingerprint) {
      if (!fingerprints.has(c.fingerprint)) {
        fingerprints.set(c.fingerprint, {
          fingerprint: c.fingerprint, count: 0, tools: new Set(),
          firstSeen: c.startedAt, lastSeen: c.startedAt,
        });
      }
      const f = fingerprints.get(c.fingerprint);
      f.count++;
      f.tools.add(c.tool);
      if (c.startedAt && (!f.firstSeen || c.startedAt < f.firstSeen)) f.firstSeen = c.startedAt;
      if (c.startedAt && (!f.lastSeen || c.startedAt > f.lastSeen)) f.lastSeen = c.startedAt;
    }
  }

  const perTool = [...tools.values()].map(t => {
    const sorted = t.durations.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    return {
      tool: t.tool,
      total: t.total,
      errors: t.errors,
      incomplete: t.incomplete,
      errorRate: t.total ? t.errors / t.total : 0,
      meanMs: sorted.length ? Math.round(sum / sorted.length) : null,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      maxMs: sorted.length ? sorted[sorted.length - 1] : null,
    };
  }).sort((a, b) => b.total - a.total);

  const totalCalls = calls.length;
  const totalErrors = calls.filter(c => c.ok === false).length;

  return {
    totalCalls,
    rawCalls: rawCalls.length,
    duplicatesDropped: rawCalls.length - totalCalls,
    totalErrors,
    errorRate: totalCalls ? totalErrors / totalCalls : 0,
    perTool,
    fingerprints: [...fingerprints.values()]
      .map(f => ({ ...f, tools: [...f.tools] }))
      .sort((a, b) => b.count - a.count),
  };
}
