/**
 * Cross-Module Search — unified search + health check.
 * 2 tools: hermit_unified_search, hermit_health.
 */

import { z } from 'zod';
import { basename, join } from 'path';
import { search } from './semantic-search.mjs';
import * as codeIntel from './code-intel/index.mjs';
import {
  loadBrain, checkStale, checkDuplicates, checkOrphans,
  checkLowConfidence, checkMissingRelations, calculateHealth,
} from './brain-health-checks.mjs';
import { zNumber } from './zod-coerce.mjs';
import { topNWithTail } from './token-diet/compact-format.mjs';
import { truncateOutput } from './token-diet/output-cap.mjs';

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
  server.tool('hermit_unified_search', 'ONE-SHOT first-step recall: searches both saved knowledge (past decisions, patterns, bugs) AND current code symbols in parallel, ranked by relevance. Use as FIRST action on any unfamiliar task — replaces 3-5 Grep queries. DON\'T grep + read separately when starting — this returns both KG and code hits in one call. DON\'T chain with hermit_search_nodes for the same query.', {
    query: z.string().min(1).max(500).describe('Search query'),
    limit: zNumber().int().min(1).max(50).optional().default(20),
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

      // Tap point 3: search:query — emitted after results are known
      if (ctx.traceBus) {
        ctx.traceBus.emit('search:query', {
          query,
          mode: 'hybrid',
          resultCount: merged.length,
        });
      }

      const sources = [];
      if (kgHits.length) sources.push(`${kgHits.length} KG`);
      if (codeHits.length) sources.push(`${codeHits.length} code`);
      if (codeResult.status === 'rejected') sources.push('code: unavailable');

      return ok(truncateOutput(formatMerged(query, merged, sources)));
    } catch (e) { return fail(e.message); }
  });

  // ── T2: Health Check ──
  server.tool('hermit_health', 'Audit the knowledge graph quality — 5 checks (stale observations, duplicates, orphans, low-confidence, missing relations) with 0-100 score and fix recommendations. Run periodically or when recall returns noisy results.', {}, RO, async () => {
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

function resolveProjectCwd(cwd) {
  if (cwd) return cwd;
  return process.env.CLAUDE_PROJECT_DIR || process.env.HERMIT_PROJECT_CWD || process.cwd();
}

function resolveDataDir(cwd) {
  return join(resolveProjectCwd(cwd), 'data');
}

async function searchCode(query, limit, cwd) {
  const projectCwd = resolveProjectCwd(cwd);
  const dataDir = resolveDataDir(projectCwd);
  // Prefer semantic query for unified search too — produces better-ranked results
  try {
    const result = await codeIntel.semanticQuery(query, dataDir, { topK: limit });
    return result.symbols.slice(0, limit).map((s) => ({
      name: s.name,
      type: 'code-symbol',
      score: typeof s.score === 'number' ? s.score : 0,
      source: 'code',
      detail: `${s.file}:${s.line[0]}`,
    }));
  } catch {
    // Fall through to substring match
  }
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
  if (!results.length) return `# Search: "${query}"\nNo results. Sources: ${sources.join(', ')}`;
  const { shown, tail } = topNWithTail(results, 20);
  const lines = shown.map(r => {
    const tag = r.source === 'kg' ? 'KG  ' : 'CODE';
    return `${tag} ${r.name} (${r.type}) ${r.detail}`;
  });
  if (tail) lines.push(tail);
  return `# Search: "${query}" — ${sources.join(', ')}\n${lines.join('\n')}`;
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
