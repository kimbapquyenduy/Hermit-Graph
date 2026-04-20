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
  if (graph.meta.commit && graph.symbols.size > 0) return dataDir;
  if (_indexingPromises.has(dataDir)) {
    await _indexingPromises.get(dataDir);
    return dataDir;
  }
  log(`codegraph: auto-indexing ${projectCwd}...`);
  const p = codeIntel.index(projectCwd, dataDir)
    .finally(() => _indexingPromises.delete(dataDir));
  _indexingPromises.set(dataDir, p);
  await p;
  log(`codegraph: auto-index complete`);
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

  // ── T1: Query (concept search) ──
  server.tool('hermit_query', 'Find code by concept — semantic code search via CodeGraph', {
    query: z.string().min(1).max(500).describe('Concept to search for in code'),
    cwd: z.string().optional().describe('Project root. Defaults to CLAUDE_PROJECT_DIR env or process.cwd()'),
  }, RO, async ({ query, cwd }) => {
    try {
      const projectCwd = resolveProjectCwd(cwd);
      const dataDir = await ensureIndex(projectCwd, log);
      const result = codeIntel.query(query, dataDir);
      return ok(`_Project: ${projectCwd}_\n\n${formatQuery(result, query)}`);
    } catch (e) { return fail(e.message); }
  });

  // ── T2: Context (360-degree symbol view) ──
  server.tool('hermit_context', 'Get 360-degree view of a symbol — callers, callees, execution flows', {
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
  server.tool('hermit_impact', 'Blast radius analysis — what breaks if you change a symbol', {
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
  server.tool('hermit_detect_changes', 'Check index status and detect what changed since last index', {
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
  server.tool('hermit_index', 'Index or re-index a project for code intelligence (runs ast-grep analyze)', {
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
      lines.push(`- **${s.name}** (${s.kind}) — \`${s.file}:${s.line[0]}\`${s.exported ? ' [exported]' : ''}`);
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
  if (!result.symbol) return `## Context: ${name}\n\nSymbol not found.`;
  const s = result.symbol;
  return [
    `## Context: ${s.name} (${s.kind})`,
    `**File:** \`${s.file}:${s.line[0]}-${s.line[1]}\``,
    `**Exported:** ${s.exported} | **Params:** ${s.params} | **Lang:** ${s.lang}`,
    '', `### Callers (${result.callers.length})`,
    ...result.callers.map(c => `- ${c.name} (\`${c.file}:${c.line[0]}\`)`),
    '', `### Callees (${result.callees.length})`,
    ...result.callees.map(c => `- ${c.name} (\`${c.file}:${c.line[0]}\`)`),
  ].join('\n');
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
