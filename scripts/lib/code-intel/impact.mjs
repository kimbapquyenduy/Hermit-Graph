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
 * Fast count-only BFS for inline risk summaries. Skips the full symbol objects
 * (no formatting, no entries) — returns counts at each depth only. Typical
 * runtime < 5ms on pre-built graph.
 *
 * @param {import('./graph.mjs').CodeGraph} graph
 * @param {string} symbolId - Must already be a valid ID (no fuzzy resolution)
 * @param {'upstream'|'downstream'|'both'} direction
 * @returns {{ d1: number, d2: number, d3: number, risk: 'LOW'|'MEDIUM'|'HIGH' }}
 */
export function impactCounts(graph, symbolId, direction = 'upstream') {
  let d1 = 0, d2 = 0, d3 = 0;
  const visited = new Set([symbolId]);
  const queue = [];
  for (const id of getNeighbors(graph, symbolId, direction)) queue.push([id, 1]);

  while (queue.length > 0) {
    const [id, depth] = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    if (depth === 1) d1++;
    else if (depth === 2) d2++;
    else if (depth === 3) d3++;
    if (depth >= 3) continue;
    for (const nextId of getNeighbors(graph, id, direction)) {
      if (!visited.has(nextId)) queue.push([nextId, depth + 1]);
    }
  }

  const risk = d1 > 5 ? 'HIGH' : d1 > 0 ? 'MEDIUM' : 'LOW';
  return { d1, d2, d3, risk };
}

/**
 * Format the Impact Preview section for embedding in hermit_context responses.
 * Returns empty string when symbol is not exported OR has 0 direct callers — both
 * cases add noise without signal. Framework-bound symbols (middleware etc.) still
 * get the preview because their hint tells the user to grep config files.
 */
export function formatImpactPreview(symbol, counts) {
  if (!symbol) return '';
  // Emit when there's signal to share:
  //   - 1+ direct callers (non-trivial refactor risk), OR
  //   - framework-bound with 0 callers (misleading LOW without the hint)
  // Skip otherwise — pure leaf helpers with no callers don't need a section.
  if (counts.d1 === 0 && !isLikelyFrameworkBound(symbol)) return '';
  const lines = [
    '',
    `### Impact Preview (upstream depth=3)`,
    `- d=1 WILL_BREAK: **${counts.d1}** caller${counts.d1 === 1 ? '' : 's'}`,
    `- d=2 LIKELY_AFFECTED: ${counts.d2}`,
    `- d=3 MAY_NEED_TESTING: ${counts.d3}`,
    `- **Risk: ${counts.risk}** — call \`hermit_impact({target: "${symbol.parent ? symbol.parent + '.' : ''}${symbol.name}"})\` for full caller list + business rules`,
  ];
  return lines.join('\n');
}

function isLikelyFrameworkBound(symbol) {
  const file = symbol.file || '';
  const parent = symbol.parent || '';

  // Case 1: file lives in a framework-dispatch directory with a convention method name
  const fwDir = /\/(middleware|commands?|jobs?|handlers?|listeners?|tasks?|observers?|events?|hooks?|subscribers?)\//i;
  const fwMethod = new Set(['handle', 'run', 'execute', 'process', 'dispatch', 'invoke', 'perform', 'fire', 'trigger', 'exec', 'call', '__invoke']);
  if (fwDir.test(file) && fwMethod.has(symbol.name)) return true;

  // Case 2: controller method — any method on a class whose name ends with Controller
  // (Adonis / Laravel / Rails pattern) invoked via route-string dispatch
  if (symbol.kind === 'method' && /Controller$/.test(parent)) return true;

  // Case 3: file lives in a Controllers/ directory (method kind) — fallback for anonymous class names
  if (symbol.kind === 'method' && /\/controllers?\//i.test(file)) return true;

  return false;
}

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
export function detectFrameworkBindingHint(symbol, callerCount) {
  if (!symbol || callerCount > 0) return '';
  if (!isLikelyFrameworkBound(symbol)) return '';
  return [
    '',
    '> **Heuristic hint:** This symbol looks framework-bound (controller method OR convention method in middleware/command/job directory).',
    '> AST sees 0 callers but framework dispatch is often string-based (e.g. `Route.post("path", "Controller.method")`,',
    '> `.middleware("user")`, `Bus::dispatch(Job::class)`). Grep for references to the class or method',
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
