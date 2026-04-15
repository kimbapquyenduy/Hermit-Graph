/**
 * Impact analysis — BFS blast radius calculation.
 * 3-hop depth: d=1 WILL_BREAK, d=2 LIKELY_AFFECTED, d=3 MAY_NEED_TESTING.
 * Confidence decays 0.9× per hop.
 */

/**
 * Calculate blast radius for a symbol change.
 * @param {import('./graph.mjs').CodeGraph} graph
 * @param {string} targetId — symbol ID to analyze
 * @param {'upstream'|'downstream'|'both'} direction
 * @returns {{ target: object, d1: object[], d2: object[], d3: object[], summary: string }}
 */
export function blastRadius(graph, targetId, direction = 'upstream') {
  const target = graph.getSymbol(targetId);
  // If exact ID not found, try fuzzy match by name
  const resolvedId = target ? targetId : resolveSymbolId(graph, targetId);
  const resolvedTarget = graph.getSymbol(resolvedId);

  if (!resolvedTarget) {
    return { target: null, d1: [], d2: [], d3: [], summary: `Symbol not found: ${targetId}` };
  }

  const d1 = [];
  const d2 = [];
  const d3 = [];
  const visited = new Set([resolvedId]);

  // BFS queue: [symbolId, depth, confidence]
  const queue = [];
  const seeds = getNeighbors(graph, resolvedId, direction);
  for (const id of seeds) {
    queue.push([id, 1, 0.95]);
  }

  while (queue.length > 0) {
    const [symId, depth, confidence] = queue.shift();
    if (visited.has(symId)) continue;
    visited.add(symId);

    const sym = graph.getSymbol(symId);
    if (!sym) continue;

    const entry = { ...sym, depth, confidence: round(confidence) };
    if (depth === 1) d1.push(entry);
    else if (depth === 2) d2.push(entry);
    else if (depth === 3) d3.push(entry);

    if (depth >= 3) continue; // max depth

    const nextConfidence = confidence * 0.9;
    for (const nextId of getNeighbors(graph, symId, direction)) {
      if (!visited.has(nextId)) {
        queue.push([nextId, depth + 1, nextConfidence]);
      }
    }
  }

  const riskLevel = d1.length > 5 ? 'HIGH' : d1.length > 0 ? 'MEDIUM' : 'LOW';
  const summary = formatSummary(resolvedTarget, d1, d2, d3, direction, riskLevel);

  return { target: resolvedTarget, d1, d2, d3, riskLevel, summary };
}

/**
 * Get 360-degree context for a symbol.
 * @param {import('./graph.mjs').CodeGraph} graph
 * @param {string} targetId
 * @returns {{ symbol: object, callers: object[], callees: object[], relations: object[] }}
 */
export function symbolContext(graph, targetId) {
  const resolvedId = graph.getSymbol(targetId) ? targetId : resolveSymbolId(graph, targetId);
  const symbol = graph.getSymbol(resolvedId);
  if (!symbol) return { symbol: null, callers: [], callees: [], relations: [] };

  return {
    symbol,
    callers: graph.getCallers(resolvedId),
    callees: graph.getCallees(resolvedId),
    relations: graph.getRelationsFor(resolvedId),
  };
}

// ── Helpers ──

function getNeighbors(graph, symbolId, direction) {
  const ids = new Set();
  if (direction === 'upstream' || direction === 'both') {
    for (const id of graph.callers.get(symbolId) || []) ids.add(id);
  }
  if (direction === 'downstream' || direction === 'both') {
    for (const id of graph.callees.get(symbolId) || []) ids.add(id);
  }
  return ids;
}

/** Try to find a symbol by name (not full ID). */
function resolveSymbolId(graph, nameOrId) {
  // Exact match first
  if (graph.symbols.has(nameOrId)) return nameOrId;
  // Search by name
  const matches = [...graph.symbols.values()].filter(s => s.name === nameOrId);
  if (matches.length === 1) return matches[0].id;
  // Partial match (contains)
  const partial = [...graph.symbols.values()].filter(s =>
    s.id.includes(nameOrId) || s.name.includes(nameOrId)
  );
  if (partial.length === 1) return partial[0].id;
  return nameOrId; // give up, return as-is
}

function round(n) { return Math.round(n * 100) / 100; }

function formatSummary(target, d1, d2, d3, direction, riskLevel) {
  const lines = [
    `## Impact: ${target.name} (${target.kind})`,
    `**File:** ${target.file}:${target.line[0]}`,
    `**Direction:** ${direction} | **Risk:** ${riskLevel}`,
    '',
    `### d=1 WILL_BREAK (${d1.length})`,
    ...d1.map(s => `- ${s.name} (${s.file}:${s.line[0]}) conf:${s.confidence}`),
    '',
    `### d=2 LIKELY_AFFECTED (${d2.length})`,
    ...d2.map(s => `- ${s.name} (${s.file}:${s.line[0]}) conf:${s.confidence}`),
    '',
    `### d=3 MAY_NEED_TESTING (${d3.length})`,
    ...d3.map(s => `- ${s.name} (${s.file}:${s.line[0]}) conf:${s.confidence}`),
  ];
  return lines.join('\n');
}
