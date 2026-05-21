/**
 * CodeGraph Module — built-in code intelligence via ast-grep.
 * 5 tools: hermit_query, hermit_context, hermit_impact, hermit_detect_changes, hermit_index.
 * In-process analysis via ast-grep (<100ms per query).
 */

import { z } from 'zod';
import { basename, join, resolve } from 'path';
import { existsSync } from 'fs';
import * as codeIntel from './code-intel/index.mjs';
import { formatSymbolCompact, formatRefCompact, topNWithTail } from './token-diet/compact-format.mjs';
import { truncateOutput } from './token-diet/output-cap.mjs';
import { featureRequestReminder } from './token-diet/feature-detect.mjs';

const RO = { readOnlyHint: true };
const IDEM = { idempotentHint: true };

// F4 container outline — kinds whose value is best summarized via member list.
const CONTAINER_KINDS = new Set(['class', 'interface', 'struct', 'trait', 'protocol', 'enum', 'module', 'namespace']);

/**
 * Collect direct members of a container symbol (matched by `parent === name`).
 * Used by F4 container outline so a class context returns its method list
 * instead of an empty "no callers/callees" message.
 */
function collectMembers(graph, parentName) {
  const out = [];
  for (const s of graph.symbols.values()) {
    if (s.parent === parentName) out.push(s);
  }
  // Stable order: by line number within file, then by name.
  out.sort((a, b) => (a.line?.[0] ?? 0) - (b.line?.[0] ?? 0) || a.name.localeCompare(b.name));
  return out;
}

// ── Data directory resolution ──

/**
 * Resolve the target project directory for CodeGraph operations.
 * Priority: explicit cwd arg → CLAUDE_PROJECT_DIR env → HERMIT_PROJECT_CWD env → process.cwd().
 * This lets CodeGraph auto-target the user's active workspace without requiring cwd on every call.
 */
function resolveProjectCwd(cwd) {
  if (cwd) return resolve(cwd);
  const envCwd = process.env.CLAUDE_PROJECT_DIR || process.env.HERMIT_PROJECT_CWD;
  return resolve(envCwd || process.cwd());
}

function resolveDataDir(cwd) {
  return join(resolveProjectCwd(cwd), 'data');
}

// ── Auto-index: ensure graph is loaded, index if needed ──
// Promise dedup prevents concurrent calls from double-indexing
const _indexingPromises = new Map();

async function ensureIndex(cwd, log) {
  const projectCwd = resolveProjectCwd(cwd);
  const dataDir = join(projectCwd, 'data');
  const graph = codeIntel.readCodeGraph(dataDir);
  // Detect populated index by symbol count, not meta.commit — non-git projects have null commit
  // but are still validly indexed. Using commit as the gate caused full reindex on every query
  // for non-git projects (symptom: 20-30s latency per tool call).
  const hasIndex = graph.symbols && graph.symbols.size > 0;

  if (_indexingPromises.has(dataDir)) {
    await _indexingPromises.get(dataDir);
    return dataDir;
  }

  // Case 1: empty index → full index
  if (!hasIndex) {
    log(`codegraph: first-time indexing ${projectCwd}...`);
    const p = codeIntel.index(projectCwd, dataDir)
      .finally(() => _indexingPromises.delete(dataDir));
    _indexingPromises.set(dataDir, p);
    await p;
    log(`codegraph: index complete`);
    return dataDir;
  }

  // Case 2: index exists → incremental reindex ONLY for git projects with actual file changes.
  // Non-git projects always report stale=true but changed=[] — skip the reindex attempt entirely.
  try {
    const { stale, changed, lastCommit } = codeIntel.changes(projectCwd, dataDir);
    const isGitProject = Boolean(lastCommit);
    if (isGitProject && stale && Array.isArray(changed) && changed.length > 0) {
      log(`codegraph: ${changed.length} file(s) changed, incremental reindex...`);
      const p = codeIntel.incrementalIndex(projectCwd, dataDir)
        .finally(() => _indexingPromises.delete(dataDir));
      _indexingPromises.set(dataDir, p);
      await p;
      log(`codegraph: incremental reindex complete`);
    }
  } catch (e) {
    log(`codegraph: stale-check skipped (${e.message})`);
  }
  return dataDir;
}

function ok(text) { return { content: [{ type: 'text', text }] }; }
function fail(text) { return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true }; }

/**
 * Wrap a tool handler to emit tool:call + tool:result trace events.
 * Returns handler unchanged when traceBus is null — zero overhead path.
 *
 * @param {string} toolName
 * @param {Function} handler
 * @param {object|null} traceBus
 * @returns {Function}
 */
function withTrace(toolName, handler, traceBus) {
  if (!traceBus) return handler;
  return async (args) => {
    traceBus.emit('tool:call', { tool: toolName, args });
    const t0 = Date.now();
    try {
      const result = await handler(args);
      traceBus.emit('tool:result', { tool: toolName, durationMs: Date.now() - t0, success: !result?.isError });
      return result;
    } catch (err) {
      traceBus.emit('tool:result', { tool: toolName, durationMs: Date.now() - t0, success: false, error: err.message });
      throw err;
    }
  };
}

/**
 * Register 5 codegraph tools.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} ctx
 */
export function register(server, ctx) {
  const { log } = ctx;

  // Tap point 2: codegraph tools — auto-wrap with trace events when traceBus active.
  const _origTool = server.tool.bind(server);
  const tracedServer = ctx.traceBus
    ? {
        tool: (name, desc, schema, ...rest) => {
          if (rest.length === 1 && typeof rest[0] === 'function') {
            return _origTool(name, desc, schema, withTrace(name, rest[0], ctx.traceBus));
          }
          if (rest.length === 2 && typeof rest[1] === 'function') {
            return _origTool(name, desc, schema, rest[0], withTrace(name, rest[1], ctx.traceBus));
          }
          return _origTool(name, desc, schema, ...rest);
        },
      }
    : server;

  // ── T1: Query (semantic concept search) ──
  tracedServer.tool('hermit_query', 'Semantic code search — finds symbols by CONCEPT, not literal substring (e.g. "authentication middleware" matches `authenticate`, `authMiddleware`, `tokenAuth`). Hybrid vector + keyword rank. Exported symbols carry [d1:N] tag showing direct-caller count. DON\'T: chain query→read for each result — call hermit_context once on the top hit instead. DON\'T grep first when you have a concept — query is faster and ranked.', {
    query: z.string().min(1).max(500).describe('Concept to search for in code (natural language OK)'),
    cwd: z.string().optional().describe('Project root. Defaults to CLAUDE_PROJECT_DIR env or process.cwd()'),
  }, RO, async ({ query, cwd }) => {
    try {
      const projectCwd = resolveProjectCwd(cwd);
      const dataDir = await ensureIndex(projectCwd, log);
      const result = await codeIntel.semanticQuery(query, dataDir);
      // Annotate symbols with direct-caller count for refactor awareness (Phase 1 of v6.5.0).
      // Include methods (parent-class members) and top-level exports, not just `exported=true` symbols.
      const graph = codeIntel.readCodeGraph(dataDir);
      for (const s of result.symbols) {
        if (s.id && (s.exported || s.parent)) {
          const counts = codeIntel.impactCounts(graph, s.id, 'upstream');
          s._d1 = counts.d1;
        }
      }
      const reminder = featureRequestReminder(query);
      return ok(truncateOutput(`_Project: ${projectCwd}_\n\n${formatQuery(result, query)}${reminder}`));
    } catch (e) { return fail(e.message); }
  });

  // ── T2: Context (360-degree symbol view) ──
  tracedServer.tool('hermit_context', 'Returns ALL callers and callees of a symbol in one shot (AST-derived call graph, not text search). For classes/interfaces/structs, returns a MEMBER OUTLINE (method names + line numbers) instead of bodies — drill into a method for its details. Includes inline Impact Preview for exported symbols.', {
    name: z.string().min(1).describe('Symbol name to get context for'),
    cwd: z.string().optional(),
  }, RO, async ({ name, cwd }) => {
    try {
      const projectCwd = resolveProjectCwd(cwd);
      const dataDir = await ensureIndex(projectCwd, log);
      const result = codeIntel.context(name, dataDir);
      // F4: container outline + impact preview share a graph read — fetch once.
      if (result.symbol && result.symbol.id) {
        const graph = codeIntel.readCodeGraph(dataDir);
        const counts = codeIntel.impactCounts(graph, result.symbol.id, 'upstream');
        result.impactPreview = codeIntel.formatImpactPreview(result.symbol, counts);
        // F4 container outline — classes, interfaces, modules return member list.
        if (CONTAINER_KINDS.has(result.symbol.kind)) {
          result.members = collectMembers(graph, result.symbol.name);
        }
      }
      return ok(truncateOutput(`_Project: ${projectCwd}_\n\n${formatContext(result, name)}`));
    } catch (e) { return fail(e.message); }
  });

  // ── T3: Impact (blast radius + business rules) ──
  tracedServer.tool('hermit_impact', 'REQUIRED before editing any exported function/class/method. Returns counts-first blast radius (d=1 WILL_BREAK, d=2 LIKELY_AFFECTED, d=3 MAY_NEED_TESTING) + d=1 caller names + business rules at risk. Pass verbose=true for full d=2/d=3 lists. DON\'T manually walk callers — impact returns transitive breakage in one call. DON\'T call on private helpers — focus on exported / framework-bound symbols.', {
    target: z.string().min(1).describe('Symbol name to analyze impact for'),
    direction: z.enum(['upstream', 'downstream', 'both']).optional().default('upstream'),
    verbose: z.boolean().optional().default(false).describe('Return full d=2 and d=3 lists (default: counts + d=1 names only)'),
    cwd: z.string().optional(),
  }, RO, async ({ target, direction, verbose, cwd }) => {
    try {
      const projectCwd = resolveProjectCwd(cwd);
      const dataDir = await ensureIndex(projectCwd, log);
      const result = codeIntel.impact(target, direction, dataDir);
      let bizSection = '';
      if (ctx.brainPath) {
        try {
          const biz = codeIntel.enrichImpact(result, ctx.brainPath);
          bizSection = formatBusinessContext(biz);
        } catch (e) {
          log(`biz-linker: ${e.message}`);
        }
      }
      const body = verbose
        ? (result.summary || `Symbol not found: ${target}`)
        : formatImpactCompact(result, target, direction);
      return ok(truncateOutput(`_Project: ${projectCwd}_\n\n${body}${bizSection}`));
    } catch (e) { return fail(e.message); }
  });

  // ── T4: Detect Changes (index status) ──
  tracedServer.tool('hermit_detect_changes', 'Check CodeGraph index freshness vs current git HEAD. Rarely needed — queries auto-reindex on stale. Use only for pre-commit scope verification ("does my change match the planned scope?").', {
    cwd: z.string().optional(),
  }, RO, async ({ cwd }) => {
    try {
      const projectCwd = resolveProjectCwd(cwd);
      const dataDir = join(projectCwd, 'data');
      const result = codeIntel.changes(projectCwd, dataDir);
      return ok(formatChanges(result));
    } catch (e) { return fail(e.message); }
  });

  // ── T5: Index (analyze project) ──
  tracedServer.tool('hermit_index', 'Force a fresh CodeGraph full rebuild. Auto-runs on first query in a project, so rarely needed. Use only when repo structure changed drastically (branch switch, large rebase) and you want a guaranteed-clean baseline.', {
    cwd: z.string().optional().describe('Project root directory to index (defaults to CLAUDE_PROJECT_DIR env or process.cwd())'),
  }, IDEM, async ({ cwd }) => {
    try {
      const projectCwd = resolveProjectCwd(cwd);
      const dataDir = join(projectCwd, 'data');
      codeIntel.clearCodeGraph(dataDir);
      const result = await codeIntel.fullIndex(projectCwd, dataDir);
      return ok(formatIndex(result.stats, projectCwd));
    } catch (e) { return fail(e.message); }
  });

  log('codegraph-module: 5 tools registered (built-in code-intel)');
}

// ── Formatters ──

// Minimum semantic match score — below this, results are dross matches the
// vector index returned for nonsense queries. Threshold tuned conservatively
// so weak-but-valid concept matches still surface; raise if false negatives.
const QUERY_MIN_SCORE = 0.30;

function formatQuery(result, q) {
  const lines = [`# Search: "${q}"`];
  // Filter out below-threshold dross — saves agent from chasing irrelevant hits.
  const relevant = (result.symbols || []).filter(s =>
    typeof s.score !== 'number' || s.score >= QUERY_MIN_SCORE
  );
  if (relevant.length) {
    const { shown, tail } = topNWithTail(relevant, 15);
    lines.push(`## Symbols (${shown.length}${tail ? ` of ${relevant.length}` : ''})`);
    for (const s of shown) lines.push(formatSymbolCompact(s));
    if (tail) lines.push(tail);
  }
  if (result.processes.length) {
    const { shown, tail } = topNWithTail(result.processes, 5);
    lines.push(`## Flows (${shown.length}${tail ? ` of ${result.processes.length}` : ''})`);
    for (const p of shown) lines.push(`- ${p.label} (${p.stepCount} steps)`);
    if (tail) lines.push(tail);
  }
  if (!relevant.length && !result.processes.length) {
    const filteredCount = (result.symbols || []).length - relevant.length;
    if (filteredCount > 0) {
      lines.push(`No high-confidence matches (${filteredCount} low-score results filtered, all < ${QUERY_MIN_SCORE}). Refine query or use hermit_search_nodes for exact-name lookup.`);
    } else {
      lines.push('No results. Try a different concept or use hermit_search_nodes for exact-name lookup.');
    }
  }
  return lines.join('\n');
}

function formatContext(result, name) {
  if (result.ambiguous) {
    const { shown, tail } = topNWithTail(result.candidates, 10);
    const lines = [
      `# Context: ${name} (ambiguous, ${result.candidates.length} matches)`,
      `Use ClassName.methodName or full ID to disambiguate:`,
    ];
    for (const c of shown) {
      const scope = c.parent ? `${c.parent}.` : '';
      lines.push(`- ${scope}${c.name} (${c.kind}) ${c.file}:${c.line[0]}`);
    }
    if (tail) lines.push(tail);
    return lines.join('\n');
  }
  if (!result.symbol) return `# Context: ${name}\nSymbol not found.`;
  const s = result.symbol;
  const meta = [s.kind];
  if (s.exported) meta.push('exp');
  if (s.lang && s.lang !== 'unknown') meta.push(s.lang);
  const lines = [
    `# ${s.name} [${meta.join(' ')}] ${s.file}:${s.line[0]}-${s.line[1]}`,
  ];
  // F4 container outline — when target is a class/interface/module, list its
  // members. Far more useful than "no callers/callees" for containers.
  if (result.members && result.members.length) {
    const { shown, tail } = topNWithTail(result.members, 25);
    lines.push(`## Members (${shown.length}${tail ? ` of ${result.members.length}` : ''})`);
    for (const m of shown) {
      const memMeta = m.exported ? ' exp' : '';
      lines.push(`- ${m.kind}: ${m.name}${memMeta} (${m.file}:${m.line[0]})`);
    }
    if (tail) lines.push(tail);
    lines.push(`Drill into a member with \`hermit_context({name: "${s.name}.<methodName>"})\` for its callers/callees.`);
  }
  if (result.callers.length) {
    const { shown, tail } = topNWithTail(result.callers, 15);
    lines.push(`## Callers (${shown.length}${tail ? ` of ${result.callers.length}` : ''})`);
    for (const c of shown) lines.push(formatRefCompact(c));
    if (tail) lines.push(tail);
  }
  if (result.callees.length) {
    const { shown, tail } = topNWithTail(result.callees, 15);
    lines.push(`## Callees (${shown.length}${tail ? ` of ${result.callees.length}` : ''})`);
    for (const c of shown) lines.push(formatRefCompact(c));
    if (tail) lines.push(tail);
  }
  // Only emit the "no callers/callees" line for non-container leaves —
  // container outline above is the meaningful answer for classes/modules.
  const hasMembers = result.members && result.members.length > 0;
  if (!result.callers.length && !result.callees.length && !hasMembers) {
    lines.push('No callers, no callees (leaf or framework-bound).');
  }
  const hint = codeIntel.detectFrameworkBindingHint(s, result.callers.length);
  if (hint) lines.push(hint);
  if (result.impactPreview) lines.push(result.impactPreview);
  return lines.join('\n');
}

/**
 * Counts-first impact summary — d1/d2/d3 counts + risk + d=1 names only.
 * Verbose mode (full d2/d3 lists) returned via the existing result.summary.
 */
function formatImpactCompact(result, target, direction) {
  if (!result.target) return `# Impact: ${target}\nSymbol not found.`;
  const t = result.target;
  const lines = [
    `# Impact: ${t.name} (${t.kind}) ${direction}`,
    `${t.file}:${t.line[0]}`,
    `d1=${result.d1.length} WILL_BREAK | d2=${result.d2.length} LIKELY | d3=${result.d3.length} MAY_NEED_TESTING | risk=${result.riskLevel}`,
  ];
  if (result.d1.length) {
    const { shown, tail } = topNWithTail(result.d1, 10);
    lines.push(`## d=1 (${shown.length}${tail ? ` of ${result.d1.length}` : ''})`);
    for (const s of shown) lines.push(formatRefCompact(s));
    if (tail) lines.push(tail);
    lines.push(`Pass verbose=true for full d=2/d=3 lists.`);
  }
  const hint = codeIntel.detectFrameworkBindingHint(t, result.d1.length);
  if (hint) lines.push(hint);
  return lines.join('\n');
}

function formatChanges(result) {
  const lines = [
    `## Index Status`,
    `**Stale:** ${result.stale ? 'Yes' : 'No'}`,
    `**Last commit:** ${result.lastCommit?.slice(0, 8) || 'none'}`,
    `**Current:** ${result.currentCommit?.slice(0, 8) || 'unknown'}`,
    `**Indexed:** ${result.indexed.files} files, ${result.indexed.symbols} symbols, ${result.indexed.relations} relations`,
  ];
  if (result.changed.length) {
    lines.push(`\n### Changed Files (${result.changed.length})`);
    for (const f of result.changed.slice(0, 20)) lines.push(`- ${f}`);
  }
  return lines.join('\n');
}

function formatIndex(stats, cwd) {
  return `## Index Complete: ${basename(cwd)}\n**Files:** ${stats.files} | **Symbols:** ${stats.symbols} | **Relations:** ${stats.relations}`;
}

const DEPTH_LABELS = ['TARGET', 'WILL_BREAK', 'LIKELY_AFFECTED', 'MAY_NEED_TESTING'];

function formatBusinessContext({ rules, flows }) {
  if (!rules.length && !flows.length) return '';
  const lines = ['', ''];
  if (rules.length) {
    lines.push(`### Business Rules at Risk (${rules.length})`);
    for (const r of rules) {
      lines.push(`- **${r.name}** (conf:${r.confidence}) — d=${r.depth} ${DEPTH_LABELS[r.depth] || ''} — via \`${r.matchedFile}\``);
    }
  }
  if (flows.length) {
    lines.push('');
    lines.push(`### Flows Affected (${flows.length})`);
    for (const f of flows) {
      lines.push(`- **${f.name}** (conf:${f.confidence}) — d=${f.depth} — via \`${f.matchedFile}\``);
    }
  }
  return lines.join('\n');
}
