/**
 * Cross-Module Search — unified search + health check.
 * 2 tools: hermit_unified_search, hermit_health.
 */

import { z } from 'zod';
import { basename, join } from 'path';
import { existsSync } from 'fs';
import { search } from './semantic-search.mjs';
import * as codeIntel from './code-intel/index.mjs';
import {
  loadBrain, checkStale, checkDuplicates, checkOrphans,
  checkLowConfidence, checkMissingRelations, calculateHealth,
} from './brain-health-checks.mjs';

const RO = { readOnlyHint: true };

function ok(text) { return { content: [{ type: 'text', text }] }; }
function fail(text) { return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true }; }

/**
 * Register 2 cross-module tools.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} ctx
 */
export function register(server, ctx) {
  const { brainPath, log } = ctx;

  // ── T1: Unified Search (KG + Code in parallel) ──
  server.tool('hermit_unified_search', 'Search knowledge graph entities AND code symbols together, ranked by relevance', {
    query: z.string().min(1).max(500).describe('Search query'),
    limit: z.number().int().min(1).max(50).optional().default(20),
    cwd: z.string().optional().describe('Working directory for code search'),
  }, RO, async ({ query, limit, cwd }) => {
    try {
      const [kgResult, codeResult] = await Promise.allSettled([
        searchKG(query, limit),
        searchCode(query, limit, cwd),
      ]);

      const kgHits = kgResult.status === 'fulfilled' ? kgResult.value : [];
      const codeHits = codeResult.status === 'fulfilled' ? codeResult.value : [];
      const merged = mergeResults(kgHits, codeHits, limit);

      const sources = [];
      if (kgHits.length) sources.push(`${kgHits.length} KG`);
      if (codeHits.length) sources.push(`${codeHits.length} code`);
      if (codeResult.status === 'rejected') sources.push('code: unavailable');

      return ok(formatMerged(query, merged, sources));
    } catch (e) { return fail(e.message); }
  });

  // ── T2: Health Check ──
  server.tool('hermit_health', 'Brain health check — 5 automated quality checks, score 0-100, recommendations', {}, RO, async () => {
    try {
      const { entities, relations } = loadBrain(brainPath);
      const checks = [
        checkStale(entities),
        checkDuplicates(entities),
        checkOrphans(entities, relations),
        checkLowConfidence(entities),
        checkMissingRelations(entities, relations),
      ];
      const score = calculateHealth(checks);
      return ok(formatHealth(score, checks, entities.length, relations.length));
    } catch (e) { return fail(e.message); }
  });

  log('unified-search: 2 tools registered');
}

// ── Search helpers ──

async function searchKG(query, limit) {
  const results = await search(query, { topK: limit });
  return results.map(r => ({
    name: r.name,
    type: r.entityType,
    score: r.score,
    source: 'kg',
    detail: `${r.observationCount || 0} obs`,
  }));
}

function resolveDataDir(cwd) {
  if (cwd) {
    const local = join(cwd, 'data');
    if (existsSync(local) || existsSync(join(cwd, 'package.json'))) return local;
  }
  return join(process.cwd(), 'data');
}

async function searchCode(query, limit, cwd) {
  if (!cwd) return [];
  const dataDir = resolveDataDir(cwd);
  const result = codeIntel.query(query, dataDir);
  return result.symbols.slice(0, limit).map((s, i, arr) => ({
    name: s.name,
    type: 'code-symbol',
    score: 1 - (i / Math.max(arr.length, 1)), // rank-based score: 1.0 → 0.0
    source: 'code',
    detail: `${s.file}:${s.line[0]}`,
  }));
}

// ── Merge + Format ──

function mergeResults(kgHits, codeHits, limit) {
  const all = [...kgHits, ...codeHits];
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, limit);
}

function formatMerged(query, results, sources) {
  if (!results.length) return `## Unified Search: "${query}"\n\nNo results found. Sources: ${sources.join(', ')}`;
  const lines = results.map((r, i) => {
    const tag = r.source === 'kg' ? '[KG]' : '[CODE]';
    return `${i + 1}. ${tag} **${r.name}** (${r.type}) — ${r.score.toFixed(3)} — ${r.detail}`;
  });
  return `## Unified Search: "${query}"\n\nSources: ${sources.join(', ')}\n\n${lines.join('\n')}`;
}

// ── Health formatting ──

function statusLabel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 70) return 'Healthy';
  if (score >= 50) return 'Needs Attention';
  return 'Unhealthy';
}

function formatHealth(score, checks, entityCount, relationCount) {
  const header = `## Brain Health: ${score}/100 (${statusLabel(score)})\n\nEntities: ${entityCount} | Relations: ${relationCount}\n`;
  const rows = checks.map(c => {
    if (c.skipped) return `| ${c.name} | SKIP | ${c.reason} |`;
    const pct = c.totalCount > 0 ? Math.round(c.violationCount / c.totalCount * 100) : 0;
    const status = c.passed ? 'PASS' : 'WARN';
    return `| ${c.name} | ${status} | ${c.violationCount}/${c.totalCount} (${pct}%) |`;
  });
  const table = `| Check | Status | Details |\n|-------|--------|---------|${rows.length ? '\n' + rows.join('\n') : ''}`;

  const recs = [];
  for (const c of checks) {
    if (c.skipped || c.passed) continue;
    if (c.name === 'Orphan Nodes') recs.push(`Link ${c.violationCount} orphan entities to parent projects`);
    if (c.name === 'Stale Entries') recs.push(`Review ${c.violationCount} stale entries`);
    if (c.name === 'Low Confidence') recs.push(`Confirm ${c.violationCount} low-confidence observations`);
    if (c.name === 'Duplicates') recs.push(`Merge ${c.violationCount} duplicate entities`);
    if (c.name === 'Missing Relations') recs.push(`Add relations for ${c.violationCount} potentially unlinked pairs`);
  }
  const recSection = recs.length ? `\n\n### Recommendations\n${recs.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : '';

  return `${header}\n${table}${recSection}`;
}
