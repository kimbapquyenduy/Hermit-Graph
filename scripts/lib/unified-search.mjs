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
  checkSchemaConformance, checkDanglingRelations, checkRelationVocabulary,
} from './brain-health-checks.mjs';
import { zNumber, zBoolean } from './zod-coerce.mjs';
import { withTimeout, DEFAULT_TOOL_TIMEOUT_MS } from './with-timeout.mjs';
import { readBrain } from './brain-io.mjs';
import { obsText } from './parse-observation.mjs';
import { tokenizeQuery, scoreEntity } from './memory-search-scoring.mjs';
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
    fast: zBoolean().optional().default(false).describe('Keyword-only: skip the vector search leg (much faster, slightly lower recall)'),
    timeout_ms: zNumber().int().min(1000).max(300000).optional().describe('Per-leg budget; a leg that overruns is reported as partial instead of hanging'),
  }, RO, async ({ query, limit, cwd, fast, timeout_ms }) => {
    try {
      // Each leg gets its own budget so one slow leg can't hang the call.
      // Measured p95 for this tool was 30s with a 96s max before this guard.
      const budget = { ms: timeout_ms ?? DEFAULT_TOOL_TIMEOUT_MS, fallback: [] };
      const [kgResult, codeResult] = await Promise.allSettled([
        fast ? searchKGKeyword(brainPath, query, limit) : withTimeout(() => searchKG(query, limit), budget),
        withTimeout(() => searchCode(query, limit, cwd), budget),
      ]);

      const legValue = (r) => {
        if (r.status !== 'fulfilled') return { hits: [], timedOut: false };
        const v = r.value;
        // fast mode returns a plain array; withTimeout returns a wrapper.
        if (Array.isArray(v)) return { hits: v, timedOut: false };
        return { hits: v.value || [], timedOut: v.timedOut };
      };
      const kgLeg = legValue(kgResult);
      const codeLeg = legValue(codeResult);
      const kgHits = kgLeg.hits;
      const codeHits = codeLeg.hits;
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
      if (fast) sources.push('fast: keyword only');
      if (kgLeg.timedOut) sources.push('KG: partial (timed out)');
      if (codeLeg.timedOut) sources.push('code: partial (timed out)');

      return ok(truncateOutput(formatMerged(query, merged, sources)));
    } catch (e) { return fail(e.message); }
  });

  // ── T2: Health Check ──
  server.tool('hermit_health', 'Audit the knowledge graph quality — 8 checks (stale observations, duplicates, orphans, low-confidence, relation suggestions, schema conformance, dangling relations, relation vocabulary) with 0-100 score and fix recommendations. Run periodically or when recall returns noisy results.', {}, RO, async () => {
    try {
      const { entities, relations, archivedNames } = loadBrain(brainPath);
      const checks = [
        checkStale(entities),
        checkDuplicates(entities),
        checkOrphans(entities, relations),
        checkLowConfidence(entities),
        checkMissingRelations(entities, relations),
        checkSchemaConformance(entities),
        checkDanglingRelations(entities, relations, archivedNames),
        checkRelationVocabulary(relations),
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

/**
 * Keyword-only KG search for `fast` mode — no embedding load, no vector index.
 * Measured p50 for keyword search is ~26ms against ~600ms for the vector leg.
 * @param {string} brainPath
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function searchKGKeyword(brainPath, query, limit) {
  const { entities } = readBrain(brainPath);
  const terms = tokenizeQuery(query);
  const scored = [];
  for (const [, e] of entities) {
    if (e._archived) continue;
    const { score } = scoreEntity(terms, e, obsText);
    if (score <= 0) continue;
    scored.push({
      name: e.name,
      type: e.entityType,
      score,
      source: 'kg',
      detail: `${(e.observations || []).length} obs`,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
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
    // INFO checks report findings without affecting the score.
    const status = c.informational ? 'INFO' : c.passed ? 'PASS' : 'WARN';
    return `| ${c.name} | ${status} | ${c.violationCount}/${c.totalCount} (${pct}%) |`;
  });
  const table = `| Check | Status | Details |\n|-------|--------|---------|${rows.length ? '\n' + rows.join('\n') : ''}`;

  const recs = [];
  for (const c of checks) {
    if (c.skipped) continue;
    if (c.name === 'Missing Relations' && c.items?.length) {
      recs.push(`Review ${c.items.length} suggested relations (highest-confidence only): ${c.items.slice(0, 3).map(i => `${i.from} ↔ ${i.to}`).join('; ')}`);
      continue;
    }
    if (c.name === 'Relation Vocabulary' && c.violationCount > 0) {
      recs.push(`${c.violationCount} relations use ${c.distinctOffenders} relationTypes outside the registry — adopt or rename, do not bulk-delete`);
      continue;
    }
    if (c.passed) continue;
    if (c.name === 'Orphan Nodes') recs.push(`Link ${c.violationCount} orphan entities to parent projects`);
    if (c.name === 'Stale Entries') recs.push(`Review ${c.violationCount} stale entries`);
    if (c.name === 'Low Confidence') recs.push(`Confirm ${c.violationCount} low-confidence observations`);
    if (c.name === 'Duplicates') recs.push(`Merge ${c.violationCount} duplicate entities`);
    if (c.name === 'Schema Conformance') recs.push(`Fix ${c.violationCount} entities violating the schema registry`);
    if (c.name === 'Dangling Relations') recs.push(`Repair ${c.violationCount} dangling relations (endpoint missing or archived)`);
  }
  const recSection = recs.length ? `\n\n### Recommendations\n${recs.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : '';

  return `${header}\n${table}${recSection}`;
}
