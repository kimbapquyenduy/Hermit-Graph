/**
 * CodeGraph Module — built-in code intelligence via ast-grep.
 * 5 tools: hermit_query, hermit_context, hermit_impact, hermit_detect_changes, hermit_index.
 * In-process analysis via ast-grep (<100ms per query).
 */

import { z } from 'zod';
import { basename, join } from 'path';
import { existsSync } from 'fs';
import * as codeIntel from './code-intel/index.mjs';

// ── Data directory resolution ──

function resolveDataDir(cwd) {
  if (cwd) {
    const local = join(cwd, 'data');
    if (existsSync(local) || existsSync(join(cwd, 'package.json'))) return local;
  }
  return join(process.cwd(), 'data');
}

// ── Auto-index: ensure graph is loaded, index if needed ──

async function ensureIndex(cwd, log) {
  const dataDir = resolveDataDir(cwd);
  const graph = codeIntel.readCodeGraph(dataDir);
  if (graph.meta.commit && graph.symbols.size > 0) return dataDir;
  log(`codegraph: auto-indexing ${cwd || process.cwd()}...`);
  await codeIntel.index(cwd || process.cwd(), dataDir);
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
    cwd: z.string().optional().describe('Working directory (git repo root). Defaults to process.cwd()'),
  }, async ({ query, cwd }) => {
    try {
      const dataDir = await ensureIndex(cwd, log);
      const result = codeIntel.query(query, dataDir);
      return ok(formatQuery(result, query));
    } catch (e) { return fail(e.message); }
  });

  // ── T2: Context (360-degree symbol view) ──
  server.tool('hermit_context', 'Get 360-degree view of a symbol — callers, callees, execution flows', {
    name: z.string().min(1).describe('Symbol name to get context for'),
    cwd: z.string().optional(),
  }, async ({ name, cwd }) => {
    try {
      const dataDir = await ensureIndex(cwd, log);
      const result = codeIntel.context(name, dataDir);
      return ok(formatContext(result, name));
    } catch (e) { return fail(e.message); }
  });

  // ── T3: Impact (blast radius) ──
  server.tool('hermit_impact', 'Blast radius analysis — what breaks if you change a symbol', {
    target: z.string().min(1).describe('Symbol name to analyze impact for'),
    direction: z.enum(['upstream', 'downstream', 'both']).optional().default('upstream'),
    cwd: z.string().optional(),
  }, async ({ target, direction, cwd }) => {
    try {
      const dataDir = await ensureIndex(cwd, log);
      const result = codeIntel.impact(target, direction, dataDir);
      return ok(result.summary || `Symbol not found: ${target}`);
    } catch (e) { return fail(e.message); }
  });

  // ── T4: Detect Changes (index status) ──
  server.tool('hermit_detect_changes', 'Check index status and detect what changed since last index', {
    cwd: z.string().optional(),
  }, async ({ cwd }) => {
    try {
      const dataDir = resolveDataDir(cwd);
      const result = codeIntel.changes(cwd || process.cwd(), dataDir);
      return ok(formatChanges(result));
    } catch (e) { return fail(e.message); }
  });

  // ── T5: Index (analyze project) ──
  server.tool('hermit_index', 'Index or re-index a project for code intelligence (runs ast-grep analyze)', {
    cwd: z.string().describe('Project root directory to index'),
    embeddings: z.boolean().optional().default(false).describe('Generate embeddings for semantic search'),
  }, async ({ cwd }) => {
    try {
      const dataDir = resolveDataDir(cwd);
      codeIntel.clearCodeGraph(dataDir);
      const result = await codeIntel.fullIndex(cwd, dataDir);
      return ok(formatIndex(result.stats, cwd));
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
