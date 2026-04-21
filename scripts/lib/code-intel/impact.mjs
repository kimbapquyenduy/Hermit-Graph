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
  // Direct ID hit
  let resolvedId = graph.getSymbol(targetId) ? targetId : null;
  let resolvedTarget = resolvedId ? graph.getSymbol(resolvedId) : null;

  // Fuzzy resolution with ambiguity reporting
  if (!resolvedTarget) {
    const r = resolveSymbol(graph, targetId);
    if (r.ambiguous) {
      const lines = [
        `## Impact: ${targetId}`,
        '',
        `Name is ambiguous — ${r.candidates.length} symbols match. Disambiguate by calling again with \`ClassName.methodName\` or full ID:`,
        '',
        ...r.candidates.map(c => {
          const scope = c.parent ? `${c.parent}.` : '';
          return `- \`${scope}${c.name}\` (${c.kind}) — \`${c.file}:${c.line[0]}\``;
        }),
      ];
      return {
        target: null, d1: [], d2: [], d3: [], riskLevel: 'UNKNOWN',
        summary: lines.join('\n'), ambiguous: true, candidates: r.candidates,
      };
    }
    resolvedId = r.id;
    resolvedTarget = resolvedId ? graph.getSymbol(resolvedId) : null;
  }

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
 * When the name is ambiguous (e.g. a common method name like `handle`), returns
 * a list of candidates so the caller can disambiguate via ClassName.methodName
 * or full ID, instead of silently failing.
 *
 * @param {import('./graph.mjs').CodeGraph} graph
 * @param {string} targetId - Name, ClassName.methodName, or full ID
 * @returns {{ symbol, callers, callees, relations, ambiguous?: boolean, candidates?: object[] }}
 */
export function symbolContext(graph, targetId) {
  // Fast path: direct ID hit
  if (graph.getSymbol(targetId)) {
    return buildContext(graph, targetId);
  }

  const resolution = resolveSymbol(graph, targetId);
  if (resolution.ambiguous) {
    return {
      symbol: null, callers: [], callees: [], relations: [],
      ambiguous: true, candidates: resolution.candidates,
    };
  }
  if (!resolution.id) {
    return { symbol: null, callers: [], callees: [], relations: [] };
  }
  return buildContext(graph, resolution.id);
}

function buildContext(graph, id) {
  return {
    symbol: graph.getSymbol(id),
    callers: graph.getCallers(id),
    callees: graph.getCallees(id),
    relations: graph.getRelationsFor(id),
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
  const r = resolveSymbol(graph, nameOrId);
  return r.id || nameOrId;
}

/**
 * Resolve a name / ClassName.methodName / full-ID to a symbol with ambiguity reporting.
 * @returns {{ id: string|null, ambiguous: boolean, candidates: object[] }}
 */
function resolveSymbol(graph, nameOrId) {
  // 1. Direct ID hit
  if (graph.symbols.has(nameOrId)) {
    return { id: nameOrId, ambiguous: false, candidates: [] };
  }

  // 2. ClassName.methodName — filter by parent
  if (nameOrId.includes('.') && !nameOrId.includes('/')) {
    const [parent, method] = nameOrId.split('.');
    const scoped = [...graph.symbols.values()].filter(s =>
      s.name === method && s.parent === parent
    );
    if (scoped.length === 1) return { id: scoped[0].id, ambiguous: false, candidates: [] };
    if (scoped.length > 1) return { id: null, ambiguous: true, candidates: scoped.slice(0, 20) };
  }

  // 3. Exact name match
  const byName = [...graph.symbols.values()].filter(s => s.name === nameOrId);
  if (byName.length === 1) return { id: byName[0].id, ambiguous: false, candidates: [] };
  if (byName.length > 1) {
    return { id: null, ambiguous: true, candidates: byName.slice(0, 20) };
  }

  // 4. Substring on name or id (loose fallback)
  const partial = [...graph.symbols.values()].filter(s =>
    s.id.includes(nameOrId) || s.name.includes(nameOrId)
  );
  if (partial.length === 1) return { id: partial[0].id, ambiguous: false, candidates: [] };
  if (partial.length > 1 && partial.length <= 20) {
    return { id: null, ambiguous: true, candidates: partial };
  }

  return { id: null, ambiguous: false, candidates: [] };
}

function round(n) { return Math.round(n * 100) / 100; }

/**
 * Detect symbols that look framework-bound (middleware, commands, jobs, handlers).
 * AST call graph is blind to string-based dispatch — these symbols typically show 0
 * callers despite being heavily invoked. Return a hint line if the symbol matches
 * the pattern, empty string otherwise.
 *
 * Heuristic signals (all required for a hint):
 *  - File path contains a framework-convention directory
 *  - Symbol name matches a framework-convention method name
 *  - Caller count is 0
 */
const FRAMEWORK_DIRS = /\/(middleware|commands?|jobs?|handlers?|listeners?|tasks?|observers?|events?|hooks?|subscribers?)\//i;
const FRAMEWORK_METHODS = new Set([
  'handle', 'run', 'execute', 'process', 'dispatch', 'invoke',
  'perform', 'fire', 'trigger', 'exec', 'call', '__invoke',
]);

export function detectFrameworkBindingHint(symbol, callerCount) {
  if (!symbol || callerCount > 0) return '';
  const file = symbol.file || '';
  if (!FRAMEWORK_DIRS.test(file)) return '';
  if (!FRAMEWORK_METHODS.has(symbol.name)) return '';
  return [
    '',
    '> **Heuristic hint:** This symbol looks framework-bound (file path + conventional method name).',
    '> AST sees 0 callers but framework dispatch is often string-based (e.g. `.middleware("user")`,',
    '> `Route::group([...])`, `Bus::dispatch(Job::class)`). Grep for references to the class or method',
    '> name in route / config / registration files to find real invocation sites.',
  ].join('\n');
}

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
  const hint = detectFrameworkBindingHint(target, d1.length);
  if (hint) lines.push(hint);
  return lines.join('\n');
}
