/**
 * CodeGraph Module — GitNexus CLI wrapper with TTL cache.
 * 5 tools: hermit_query, hermit_context, hermit_impact, hermit_detect_changes, hermit_index.
 * Direct binary execution with shell:false for speed (~100ms vs ~1600ms).
 *
 * GitNexus CLI uses positional args (not --flag style):
 *   query <search_query> [-l <n>]
 *   context [name] [-f <file>]
 *   impact <target> [-d <direction>]
 *   status (index status for current repo)
 *   analyze [--embeddings] (index/re-index a project)
 */

import { z } from 'zod';
import { basename } from 'path';
import { runGitNexus } from './gitnexus-runner.mjs';

// ── TTL Cache — avoids re-spawning subprocess for identical queries ──

const CACHE_TTL = {
  query: 20 * 60 * 1000,   // 20 min
  context: 20 * 60 * 1000, // 20 min
  impact: 10 * 60 * 1000,  // 10 min
  status: 2 * 60 * 1000,   // 2 min
};
const MAX_CACHE_SIZE = 100;
const _cache = new Map(); // key → { data, expiry }

function cacheKey(cmd, args, cwd) {
  return `${cmd}|${cwd || ''}|${args.join(',')}`;
}

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiry) { _cache.delete(key); return undefined; }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  // Evict oldest entries if cache is full
  if (_cache.size >= MAX_CACHE_SIZE) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(key, { data, expiry: Date.now() + ttlMs });
}

/** Invalidate all cache entries for a cwd (called after hermit_index). */
function cacheInvalidate(cwd) {
  const prefix = cwd ? `|${cwd}|` : null;
  for (const key of _cache.keys()) {
    if (!prefix || key.includes(prefix)) _cache.delete(key);
  }
}

/** Cached wrapper around runGitNexus. */
async function cachedRunGitNexus(cmd, args, cwd, timeoutMs) {
  const ttl = CACHE_TTL[cmd];
  if (ttl) {
    const key = cacheKey(cmd, args, cwd);
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;
    const result = await runGitNexus(cmd, args, cwd, timeoutMs);
    cacheSet(key, result, ttl);
    return result;
  }
  return runGitNexus(cmd, args, cwd, timeoutMs);
}

/** MCP response helpers. */
function ok(text) { return { content: [{ type: 'text', text }] }; }
function fail(text) { return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true }; }

/**
 * Derive --repo flag from cwd path. GitNexus uses the directory basename
 * as the repo name when multiple repos are indexed.
 * @param {string} cwd
 * @returns {string[]} e.g. ['-r', 'claudekit-cli']
 */
function repoFlag(cwd) {
  if (!cwd) return [];
  const name = basename(cwd.replace(/[\\/]+$/, ''));
  return name ? ['-r', name] : [];
}

const ANALYZE_TIMEOUT_MS = 120000;

/** Check if error is due to stale or missing index. */
function isIndexError(err) {
  const msg = err?.message || '';
  return msg.includes('NOT_INDEXED') || msg.includes('STALE_INDEX') || msg.includes('not indexed');
}

/**
 * Run a codegraph command with auto-reindex on stale/missing index.
 * Tries once, if index error → reindex → retry once.
 */
async function withAutoReindex(fn, cwd, log) {
  try {
    return await fn();
  } catch (err) {
    if (!isIndexError(err) || !cwd) throw err;

    log(`codegraph: index error detected, auto-reindexing ${cwd}...`);
    try {
      await runGitNexus('analyze', [], cwd, ANALYZE_TIMEOUT_MS);
      cacheInvalidate(cwd);
      log(`codegraph: reindex complete, retrying...`);
      return await fn();
    } catch (reindexErr) {
      throw new Error(`Auto-reindex failed: ${reindexErr.message}. Use hermit_index tool manually.`);
    }
  }
}

/**
 * Register 5 codegraph tools.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} ctx
 */
export function register(server, ctx) {
  const { log } = ctx;

  // ── T1: Query (concept search) — positional: query <search_query> ──
  server.tool('hermit_query', 'Find code by concept — semantic code search via GitNexus', {
    query: z.string().min(1).max(500).describe('Concept to search for in code'),
    cwd: z.string().optional().describe('Working directory (git repo root). Defaults to process.cwd()'),
  }, async ({ query, cwd }) => {
    try {
      const out = await withAutoReindex(
        () => cachedRunGitNexus('query', [query, ...repoFlag(cwd)], cwd),
        cwd, log
      );
      return ok(formatQueryResult(out, query));
    } catch (e) { return fail(e.message); }
  });

  // ── T2: Context (360-degree symbol view) — positional: context [name] ──
  server.tool('hermit_context', 'Get 360-degree view of a symbol — callers, callees, execution flows', {
    name: z.string().min(1).describe('Symbol name to get context for'),
    cwd: z.string().optional(),
  }, async ({ name, cwd }) => {
    try {
      const out = await withAutoReindex(
        () => cachedRunGitNexus('context', [name, ...repoFlag(cwd)], cwd),
        cwd, log
      );
      return ok(formatContextResult(out, name));
    } catch (e) { return fail(e.message); }
  });

  // ── T3: Impact (blast radius) — positional: impact <target> [-d direction] ──
  server.tool('hermit_impact', 'Blast radius analysis — what breaks if you change a symbol', {
    target: z.string().min(1).describe('Symbol name to analyze impact for'),
    direction: z.enum(['upstream', 'downstream', 'both']).optional().default('upstream'),
    cwd: z.string().optional(),
  }, async ({ target, direction, cwd }) => {
    try {
      const out = await withAutoReindex(
        () => cachedRunGitNexus('impact', [target, '-d', direction, ...repoFlag(cwd)], cwd),
        cwd, log
      );
      return ok(formatImpactResult(out, target));
    } catch (e) { return fail(e.message); }
  });

  // ── T4: Detect Changes (index status) — `gitnexus status` ──
  server.tool('hermit_detect_changes', 'Check index status and detect what changed since last index', {
    cwd: z.string().optional(),
  }, async ({ cwd }) => {
    try {
      cacheInvalidate(cwd); // Clear stale cache when checking status (handles external reindex)
      const out = await cachedRunGitNexus('status', [], cwd);
      return ok(formatChangesResult(out));
    } catch (e) {
      if (isIndexError(e)) {
        return ok('Index not found or stale. Run hermit_index to index this project.');
      }
      return fail(e.message);
    }
  });

  // ── T5: Index (analyze project) — `gitnexus analyze` ──
  server.tool('hermit_index', 'Index or re-index a project for code intelligence (runs GitNexus analyze)', {
    cwd: z.string().describe('Project root directory to index'),
    embeddings: z.boolean().optional().default(false).describe('Generate embeddings for semantic search'),
  }, async ({ cwd, embeddings }) => {
    try {
      const args = embeddings ? ['--embeddings'] : [];
      const out = await runGitNexus('analyze', args, cwd, ANALYZE_TIMEOUT_MS);
      cacheInvalidate(cwd); // Clear stale cache after re-indexing
      return ok(formatIndexResult(out, cwd));
    } catch (e) { return fail(e.message); }
  });

  log('codegraph-module: 5 tools registered');
}

// ── Output formatters (parse JSON or return raw) ──

function tryParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function formatQueryResult(raw, query) {
  const data = tryParse(raw);
  if (!data) return `## Code Search: "${query}"\n\n${raw}`;

  // GitNexus returns {processes, process_symbols, definitions} object
  const sections = [];
  if (data.processes?.length) {
    sections.push(`### Execution Flows (${data.processes.length})\n` +
      data.processes.slice(0, 10).map((p, i) =>
        `${i + 1}. **${p.summary || p.id}** — priority: ${p.priority?.toFixed(3) || '?'}`
      ).join('\n'));
  }
  if (data.definitions?.length) {
    sections.push(`### Definitions (${data.definitions.length})\n` +
      data.definitions.slice(0, 15).map((d, i) =>
        `${i + 1}. **${d.name}** — \`${d.filePath || '?'}\``
      ).join('\n'));
  }
  if (data.process_symbols?.length) {
    sections.push(`### Symbols in Flows (${data.process_symbols.length})\n` +
      data.process_symbols.slice(0, 10).map((s, i) =>
        `${i + 1}. **${s.name || s.symbol}** (${s.filePath || s.file || '?'}:${s.startLine || s.line || '?'})`
      ).join('\n'));
  }

  // Fallback for old array format or unknown structure
  if (!sections.length) {
    if (Array.isArray(data)) {
      const lines = data.slice(0, 20).map((r, i) =>
        `${i + 1}. **${r.symbol || r.name || 'unknown'}** (${r.file || '?'}:${r.line || '?'})\n   Score: ${r.score?.toFixed(2) || '?'}`
      );
      return `## Code Search: "${query}"\n\nFound ${data.length} matches:\n\n${lines.join('\n\n')}`;
    }
    return `## Code Search: "${query}"\n\n${JSON.stringify(data, null, 2)}`;
  }

  return `## Code Search: "${query}"\n\n${sections.join('\n\n')}`;
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

function formatIndexResult(raw, cwd) {
  return `## Index Complete: ${basename(cwd)}\n\n${raw}`;
}
