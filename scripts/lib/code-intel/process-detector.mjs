/**
 * Execution flow / process detection — traces call chains from entry points.
 * Heuristic-based: detects HTTP handlers, exported functions, CLI entry points.
 * Groups symbols into "processes" (user-facing features / business operations).
 */

/**
 * Detect execution flows (processes) from the code graph.
 * @param {import('./graph.mjs').CodeGraph} graph
 * @returns {object[]} Array of process objects
 */
export function detectProcesses(graph) {
  const entryPoints = findEntryPoints(graph);
  const processes = [];
  const usedSymbols = new Set(); // avoid duplicate process membership

  for (const entry of entryPoints) {
    const chain = traceCallChain(graph, entry.id, 10);
    if (chain.length < 2) continue; // skip trivial chains

    const label = inferLabel(entry, chain);
    const communities = detectCommunities(chain);

    processes.push({
      id: `process::${label}`,
      label,
      entryPoint: entry.id,
      terminal: chain[chain.length - 1].id,
      steps: chain.map((s, i) => ({ step: i + 1, symbol: s.id, name: s.name, file: s.file })),
      stepCount: chain.length,
      communities,
    });

    for (const s of chain) usedSymbols.add(s.id);
  }

  // Sort by step count descending (longest flows first)
  processes.sort((a, b) => b.stepCount - a.stepCount);
  return processes;
}

/**
 * Find potential entry points in the graph.
 * Heuristics: exported functions, HTTP handlers, CLI commands, register().
 */
function findEntryPoints(graph) {
  const entries = [];

  for (const sym of graph.symbols.values()) {
    if (sym.kind !== 'function' && sym.kind !== 'method') continue;
    const score = entryPointScore(sym, graph);
    if (score > 0) entries.push({ ...sym, _score: score });
  }

  // Sort by score descending, take top entries
  entries.sort((a, b) => b._score - a._score);
  return entries.slice(0, 50); // cap to prevent explosion
}

/**
 * Score how likely a symbol is an entry point (0 = not, higher = more likely).
 */
function entryPointScore(sym, graph) {
  let score = 0;
  const name = sym.name.toLowerCase();

  // Exported symbols are more likely entry points
  if (sym.exported) score += 1;

  // Has no callers (nothing calls this) — likely top-level entry
  const callers = graph.callers.get(sym.id);
  if (!callers || callers.size === 0) score += 2;

  // Name patterns suggesting entry point
  if (name.startsWith('handle') || name.startsWith('on')) score += 2;
  if (name.startsWith('register') || name.startsWith('setup') || name.startsWith('init')) score += 2;
  if (name.startsWith('run') || name.startsWith('start') || name.startsWith('main')) score += 3;
  if (name.startsWith('process') || name.startsWith('execute')) score += 1;
  if (name.includes('route') || name.includes('endpoint') || name.includes('handler')) score += 2;
  if (name.includes('middleware') || name.includes('plugin')) score += 1;

  // File path patterns
  const file = sym.file.toLowerCase();
  if (file.includes('index.') || file.includes('main.') || file.includes('app.')) score += 1;
  if (file.includes('server.') || file.includes('cli.') || file.includes('handler')) score += 1;

  // Has many callees (orchestrator pattern)
  const callees = graph.callees.get(sym.id);
  if (callees && callees.size >= 3) score += 1;

  return score;
}

/**
 * Trace a DFS call chain from an entry point, following CALLS edges.
 * Returns ordered list of symbols in the execution flow.
 */
function traceCallChain(graph, startId, maxDepth) {
  const chain = [];
  const visited = new Set();

  function dfs(symId, depth) {
    if (depth > maxDepth || visited.has(symId)) return;
    visited.add(symId);
    const sym = graph.getSymbol(symId);
    if (!sym) return;
    chain.push(sym);
    // Follow callees (downstream)
    const callees = graph.callees.get(symId);
    if (callees) {
      for (const nextId of callees) {
        if (!visited.has(nextId)) dfs(nextId, depth + 1);
      }
    }
  }

  dfs(startId, 0);
  return chain;
}

/**
 * Infer a human-readable label for a process from its entry point and chain.
 */
function inferLabel(entry, chain) {
  // Use entry point name as base, strip common prefixes
  let label = entry.name
    .replace(/^(handle|on|register|setup|init|run|start|process|execute)/, '')
    .replace(/^[A-Z]/, c => c.toLowerCase());

  if (!label || label.length < 2) label = entry.name;

  // Capitalize first letter
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Detect which modules/folders a process spans.
 * Simple heuristic: group by top-level directory.
 */
function detectCommunities(chain) {
  const dirs = new Set();
  for (const sym of chain) {
    const parts = sym.file.split('/');
    // Use first meaningful directory (skip 'scripts', 'src', 'lib')
    const dir = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    if (dir) dirs.add(dir);
  }
  return [...dirs];
}
