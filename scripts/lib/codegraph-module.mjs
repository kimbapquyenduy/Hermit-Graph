/**
 * CodeGraph Module — built-in code intelligence via ast-grep.
 * 5 tools: hermit_query, hermit_context, hermit_impact, hermit_detect_changes, hermit_index.
 * In-process analysis via ast-grep (<100ms per query).
 */

import { z } from 'zod';
import { basename, join, resolve } from 'path';
import { existsSync } from 'fs';
import * as codeIntel from './code-intel/index.mjs';

const RO = { readOnlyHint: true };
const IDEM = { idempotentHint: true };

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
 * Register 5 codegraph tools.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} ctx
 */
export function register(server, ctx) {
  const { log } = ctx;

  // ── T1: Query (semantic concept search) ──
  server.tool('hermit_query', 'Semantic code search — finds symbols by CONCEPT, not literal substring (e.g. "authentication middleware" matches `authenticate`, `authMiddleware`, `tokenAuth`). Hybrid vector + keyword rank using all-MiniLM-L6-v2 embeddings. First call per project auto-builds symbol embedding index (~30-60s for medium repo), cached thereafter. Falls back to keyword-only if model unavailable.', {
    query: z.string().min(1).max(500).describe('Concept to search for in code (natural language OK)'),
    cwd: z.string().optional().describe('Project root. Defaults to CLAUDE_PROJECT_DIR env or process.cwd()'),
  }, RO, async ({ query, cwd }) => {
    try {
      const projectCwd = resolveProjectCwd(cwd);
      const dataDir = await ensureIndex(projectCwd, log);
      const result = await codeIntel.semanticQuery(query, dataDir);
      return ok(`_Project: ${projectCwd}_\n\n${formatQuery(result, query)}`);
    } catch (e) { return fail(e.message); }
  });

  // ── T2: Context (360-degree symbol view) ──
  server.tool('hermit_context', 'Returns ALL callers and callees of a symbol in one shot (AST-derived call graph, not text search). Use BEFORE refactoring to see the full neighborhood. Faster and more complete than grepping for a function name across files.', {
    name: z.string().min(1).describe('Symbol name to get context for'),
    cwd: z.string().optional(),
  }, RO, async ({ name, cwd }) => {
    try {
      const projectCwd = resolveProjectCwd(cwd);
      const dataDir = await ensureIndex(projectCwd, log);
      const result = codeIntel.context(name, dataDir);
      return ok(`_Project: ${projectCwd}_\n\n${formatContext(result, name)}`);
    } catch (e) { return fail(e.message); }
  });

  // ── T3: Impact (blast radius + business rules) ──
  server.tool('hermit_impact', 'REQUIRED before editing any exported function/class/method. Returns TRANSITIVE callers (d=1 WILL_BREAK = direct callers, d=2 LIKELY_AFFECTED = indirect, d=3 MAY_NEED_TESTING). Grep cannot find transitive breakage — only AST call-graph analysis can. Also overlays business rules at risk.', {
    target: z.string().min(1).describe('Symbol name to analyze impact for'),
    direction: z.enum(['upstream', 'downstream', 'both']).optional().default('upstream'),
    cwd: z.string().optional(),
  }, RO, async ({ target, direction, cwd }) => {
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
      return ok(`_Project: ${projectCwd}_\n\n${result.summary || `Symbol not found: ${target}`}${bizSection}`);
    } catch (e) { return fail(e.message); }
  });

  // ── T4: Detect Changes (index status) ──
  server.tool('hermit_detect_changes', 'Check CodeGraph index freshness vs current git HEAD. Rarely needed — queries auto-reindex on stale. Use only for pre-commit scope verification ("does my change match the planned scope?").', {
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
  server.tool('hermit_index', 'Force a fresh CodeGraph full rebuild. Auto-runs on first query in a project, so rarely needed. Use only when repo structure changed drastically (branch switch, large rebase) and you want a guaranteed-clean baseline.', {
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

function formatQuery(result, q) {
  const lines = [`## Code Search: "${q}"\n`];
  if (result.symbols.length) {
    lines.push(`### Symbols (${result.symbols.length})`);
    for (const s of result.symbols) {
      const score = typeof s.score === 'number' ? ` \`${s.score.toFixed(3)}\`` : '';
      lines.push(`-${score} **${s.name}** (${s.kind}) — \`${s.file}:${s.line[0]}\`${s.exported ? ' [exported]' : ''}`);
    }
  }
  if (result.processes.length) {
    lines.push(`\n### Execution Flows (${result.processes.length})`);
    for (const p of result.processes) {
      lines.push(`- **${p.label}** — ${p.stepCount} steps, communities: ${p.communities.join(', ')}`);
    }
  }
  if (!result.symbols.length && !result.processes.length) {
    lines.push('No results found.');
  }
  return lines.join('\n');
}

function formatContext(result, name) {
  if (result.ambiguous) {
    const lines = [
      `## Context: ${name}`,
      '',
      `Name is ambiguous — ${result.candidates.length} symbols match. Disambiguate by calling again with \`ClassName.methodName\` or full ID:`,
      '',
      ...result.candidates.map(c => {
        const scope = c.parent ? `${c.parent}.` : '';
        return `- \`${scope}${c.name}\` (${c.kind}) — \`${c.file}:${c.line[0]}\``;
      }),
    ];
    return lines.join('\n');
  }
  if (!result.symbol) return `## Context: ${name}\n\nSymbol not found.`;
  const s = result.symbol;
  const lines = [
    `## Context: ${s.name} (${s.kind})`,
    `**File:** \`${s.file}:${s.line[0]}-${s.line[1]}\``,
    `**Exported:** ${s.exported} | **Params:** ${s.params} | **Lang:** ${s.lang}`,
    '', `### Callers (${result.callers.length})`,
    ...result.callers.map(c => `- ${c.name} (\`${c.file}:${c.line[0]}\`)`),
    '', `### Callees (${result.callees.length})`,
    ...result.callees.map(c => `- ${c.name} (\`${c.file}:${c.line[0]}\`)`),
  ];
  const hint = codeIntel.detectFrameworkBindingHint(s, result.callers.length);
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
