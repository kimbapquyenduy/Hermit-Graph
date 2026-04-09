/**
 * CodeGraph Module — GitNexus CLI wrapper.
 * 4 tools: hermit_query, hermit_context, hermit_impact, hermit_detect_changes.
 * Shells out to `npx gitnexus` with 30s timeout.
 */

import { z } from 'zod';
import { runGitNexus } from './gitnexus-runner.mjs';

/** MCP response helpers. */
function ok(text) { return { content: [{ type: 'text', text }] }; }
function fail(text) { return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true }; }

/**
 * Register 4 codegraph tools.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} ctx
 */
export function register(server, ctx) {
  const { log } = ctx;

  // ── T1: Query (concept search) ──
  server.tool('hermit_query', 'Find code by concept — semantic code search via GitNexus', {
    query: z.string().min(1).max(500).describe('Concept to search for in code'),
    cwd: z.string().optional().describe('Working directory (git repo root). Defaults to process.cwd()'),
  }, async ({ query, cwd }) => {
    try {
      const out = await runGitNexus('query', ['--query', query, '--json'], cwd);
      return ok(formatQueryResult(out, query));
    } catch (e) { return fail(e.message); }
  });

  // ── T2: Context (360-degree symbol view) ──
  server.tool('hermit_context', 'Get 360-degree view of a symbol — callers, callees, execution flows', {
    name: z.string().min(1).describe('Symbol name to get context for'),
    cwd: z.string().optional(),
  }, async ({ name, cwd }) => {
    try {
      const out = await runGitNexus('context', ['--name', name, '--json'], cwd);
      return ok(formatContextResult(out, name));
    } catch (e) { return fail(e.message); }
  });

  // ── T3: Impact (blast radius) ──
  server.tool('hermit_impact', 'Blast radius analysis — what breaks if you change a symbol', {
    target: z.string().min(1).describe('Symbol name to analyze impact for'),
    direction: z.enum(['upstream', 'downstream', 'both']).optional().default('upstream'),
    cwd: z.string().optional(),
  }, async ({ target, direction, cwd }) => {
    try {
      const out = await runGitNexus('impact', ['--target', target, '--direction', direction, '--json'], cwd);
      return ok(formatImpactResult(out, target));
    } catch (e) { return fail(e.message); }
  });

  // ── T4: Detect Changes (pre-commit check) ──
  server.tool('hermit_detect_changes', 'Pre-commit scope check — what symbols and flows changed', {
    scope: z.enum(['all', 'staged', 'compare']).optional().default('all'),
    base_ref: z.string().optional().describe("Base ref for compare mode (e.g., 'main')"),
    cwd: z.string().optional(),
  }, async ({ scope, base_ref, cwd }) => {
    try {
      const args = ['--scope', scope, '--json'];
      if (base_ref) args.push('--base-ref', base_ref);
      const out = await runGitNexus('detect-changes', args, cwd);
      return ok(formatChangesResult(out));
    } catch (e) { return fail(e.message); }
  });

  log('codegraph-module: 4 tools registered');
}

// ── Output formatters (parse JSON or return raw) ──

function tryParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function formatQueryResult(raw, query) {
  const data = tryParse(raw);
  if (!data) return `## Code Search: "${query}"\n\n${raw}`;
  if (Array.isArray(data)) {
    const lines = data.slice(0, 20).map((r, i) =>
      `${i + 1}. **${r.symbol || r.name || 'unknown'}** (${r.file || '?'}:${r.line || '?'})\n   Score: ${r.score?.toFixed(2) || '?'}`
    );
    return `## Code Search: "${query}"\n\nFound ${data.length} matches:\n\n${lines.join('\n\n')}`;
  }
  return `## Code Search: "${query}"\n\n${JSON.stringify(data, null, 2)}`;
}

function formatContextResult(raw, name) {
  const data = tryParse(raw);
  if (!data) return `## Context: ${name}\n\n${raw}`;
  return `## Context: ${name}\n\n${JSON.stringify(data, null, 2)}`;
}

function formatImpactResult(raw, target) {
  const data = tryParse(raw);
  if (!data) return `## Impact: ${target}\n\n${raw}`;
  return `## Impact: ${target}\n\n${JSON.stringify(data, null, 2)}`;
}

function formatChangesResult(raw) {
  const data = tryParse(raw);
  if (!data) return `## Detected Changes\n\n${raw}`;
  return `## Detected Changes\n\n${JSON.stringify(data, null, 2)}`;
}
