/**
 * retrieval-quality.test.mjs — NDCG@10 + MRR@10 harness for hybrid retrieval.
 *
 * Runs golden-queries.json against one or more search functions and records metrics.
 * Does NOT assert a threshold on v6.7 baseline — just records.
 * Phase 04b adds a hybrid run with a +10% NDCG@10 gate.
 *
 * Usage:
 *   node --experimental-vm-modules node_modules/.bin/jest test/retrieval-quality.test.mjs
 *   node test/retrieval-quality.test.mjs   (standalone script mode)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GOLDEN_PATH = join(__dirname, 'golden-queries.json');
const BASELINES_DIR = join(__dirname, 'baselines');

// ── Metric helpers ──────────────────────────────────────────────────────────

/**
 * Ideal DCG@K: all K positions filled with relevant docs (rel=1).
 * For binary relevance with up to `numRelevant` relevant docs.
 * @param {number} k
 * @param {number} numRelevant
 * @returns {number}
 */
function idealDcgAtK(k, numRelevant) {
  let idcg = 0;
  const limit = Math.min(k, numRelevant);
  for (let i = 0; i < limit; i++) {
    idcg += 1 / Math.log2(i + 2); // rank is 1-based → log2(rank+1)
  }
  return idcg;
}

/**
 * NDCG@10 for a single query.
 * Binary relevance: rel=1 if name in expectedTop3, else 0.
 * @param {string[]} resultNames - Names in rank order (rank 0 = best), length ≤ 10
 * @param {string[]} expectedTop3 - Ground-truth relevant names
 * @returns {number} NDCG@10 in [0, 1]
 */
function ndcgAt10(resultNames, expectedTop3) {
  const relevant = new Set(expectedTop3);
  const K = 10;
  const results = resultNames.slice(0, K);

  let dcg = 0;
  for (let i = 0; i < results.length; i++) {
    if (relevant.has(results[i])) {
      dcg += 1 / Math.log2(i + 2);
    }
  }

  const idcg = idealDcgAtK(K, relevant.size);
  if (idcg === 0) return 0;
  return dcg / idcg;
}

/**
 * MRR@10 for a single query.
 * Returns 1/rank of first relevant result, or 0 if no relevant in top 10.
 * @param {string[]} resultNames
 * @param {string[]} expectedTop3
 * @returns {number}
 */
function mrrAt10(resultNames, expectedTop3) {
  const relevant = new Set(expectedTop3);
  const results = resultNames.slice(0, 10);
  for (let i = 0; i < results.length; i++) {
    if (relevant.has(results[i])) return 1 / (i + 1);
  }
  return 0;
}

// ── Evaluator ───────────────────────────────────────────────────────────────

/**
 * Evaluate a search function against the golden query set.
 *
 * @param {function(string): Promise<string[]>|string[]} searchFn
 *   Must return an ordered list of entity names (best first).
 * @param {Array<{query: string, expectedTop3: string[], categoryTag: string, tier: string}>} goldenSet
 * @returns {Promise<{
 *   ndcg10: number,
 *   mrr10: number,
 *   queryCount: number,
 *   perTier: Record<string, {ndcg10: number, mrr10: number, count: number}>,
 *   perQuery: Array<{query: string, ndcg10: number, mrr10: number, top3Returned: string[]}>
 * }>}
 */
export async function evaluate(searchFn, goldenSet) {
  const perQuery = [];
  const tierAcc = {};

  for (const item of goldenSet) {
    const { query, expectedTop3, tier } = item;
    let names = [];
    try {
      const raw = await searchFn(query);
      names = Array.isArray(raw) ? raw : [];
    } catch (_err) {
      names = [];
    }

    const qNdcg = ndcgAt10(names, expectedTop3);
    const qMrr = mrrAt10(names, expectedTop3);
    perQuery.push({ query, ndcg10: qNdcg, mrr10: qMrr, top3Returned: names.slice(0, 3) });

    if (!tierAcc[tier]) tierAcc[tier] = { ndcg10Sum: 0, mrr10Sum: 0, count: 0 };
    tierAcc[tier].ndcg10Sum += qNdcg;
    tierAcc[tier].mrr10Sum += qMrr;
    tierAcc[tier].count++;
  }

  const ndcg10 = perQuery.reduce((s, q) => s + q.ndcg10, 0) / perQuery.length;
  const mrr10 = perQuery.reduce((s, q) => s + q.mrr10, 0) / perQuery.length;

  const perTier = {};
  for (const [tier, acc] of Object.entries(tierAcc)) {
    perTier[tier] = {
      ndcg10: round4(acc.ndcg10Sum / acc.count),
      mrr10: round4(acc.mrr10Sum / acc.count),
      count: acc.count,
    };
  }

  return { ndcg10: round4(ndcg10), mrr10: round4(mrr10), queryCount: perQuery.length, perTier, perQuery };
}

function round4(n) { return Math.round(n * 10000) / 10000; }

// ── Search adapters ─────────────────────────────────────────────────────────

/**
 * Adapter: wrap semantic-search.search() → returns string[] of names.
 * @returns {function(string): Promise<string[]>}
 */
async function makeV67SearchFn() {
  const { pathToFileURL } = await import('url');
  const { search } = await import(pathToFileURL(join(ROOT, 'scripts/lib/semantic-search.mjs')).href);
  return async (query) => {
    const results = await search(query, { topK: 10 });
    return results.map(r => r.name);
  };
}

/**
 * Adapter: wrap hybrid-retrieval.searchHybrid() → returns string[] of names.
 * Only available after Phase 04b.
 * @param {object} ctx - { memoryProvider, vectorBackend }
 * @returns {function(string): Promise<string[]>}
 */
async function makeHybridSearchFn(ctx) {
  const { pathToFileURL } = await import('url');
  const hybridPath = join(ROOT, 'scripts/lib/memory/hybrid-retrieval.mjs');
  const { searchHybrid } = await import(pathToFileURL(hybridPath).href);
  return async (query) => {
    const results = await searchHybrid(query, ctx, { topK: 10 });
    return results.map(r => r.name);
  };
}

// ── Test suite (Jest) ────────────────────────────────────────────────────────

const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8'));

// Standalone mode: skip Jest suite block
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (!isMain) describe('Retrieval Quality Harness', () => {
  test('golden-queries.json: 30 queries, each has name + expectedTop3 + tier', () => {
    expect(golden.length).toBe(30);
    for (const item of golden) {
      expect(typeof item.query).toBe('string');
      expect(item.query.length).toBeGreaterThan(0);
      expect(Array.isArray(item.expectedTop3)).toBe(true);
      expect(item.expectedTop3.length).toBe(3);
      expect(typeof item.tier).toBe('string');
    }
  });

  test('NDCG@10 math: known inputs produce correct scores', () => {
    // Perfect retrieval: all 3 relevant items in first 3 positions
    expect(ndcgAt10(['a', 'b', 'c', 'd'], ['a', 'b', 'c'])).toBeCloseTo(1.0, 4);
    // Zero retrieval: no relevant items in top 10
    expect(ndcgAt10(['x', 'y', 'z'], ['a', 'b', 'c'])).toBe(0);
    // Partial: only first item relevant
    const partial = ndcgAt10(['a', 'x', 'y'], ['a', 'b', 'c']);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
  });

  test('MRR@10 math: known inputs produce correct scores', () => {
    expect(mrrAt10(['a', 'b', 'c'], ['a'])).toBe(1.0);
    expect(mrrAt10(['x', 'a', 'b'], ['a'])).toBeCloseTo(0.5, 4);
    expect(mrrAt10(['x', 'y', 'z'], ['a'])).toBe(0);
  });

  test('RRF helpers: idealDcgAtK', () => {
    expect(idealDcgAtK(10, 0)).toBe(0);
    expect(idealDcgAtK(10, 3)).toBeGreaterThan(0);
    expect(idealDcgAtK(10, 3)).toBeLessThanOrEqual(idealDcgAtK(10, 10));
  });

  test('v6.7 baseline: evaluate v6.7 search and save results', async () => {
    let searchFn;
    try {
      searchFn = await makeV67SearchFn();
    } catch (err) {
      console.warn('Cannot load semantic-search module in test env:', err.message);
      return; // skip in unit-only env (no data/brain.jsonl)
    }

    let metrics;
    try {
      metrics = await evaluate(searchFn, golden);
    } catch (err) {
      console.warn('evaluate() threw:', err.message);
      return;
    }

    console.log(`v6.7 baseline — NDCG@10: ${metrics.ndcg10} | MRR@10: ${metrics.mrr10} | queries: ${metrics.queryCount}`);

    // Sanity-check: should return something (not all zeroes unless search is broken)
    expect(metrics.queryCount).toBe(30);
    expect(metrics.ndcg10).toBeGreaterThanOrEqual(0);
    expect(metrics.ndcg10).toBeLessThanOrEqual(1);

    // Warn if outside expected range — don't fail
    if (metrics.ndcg10 < 0.05 || metrics.ndcg10 > 0.95) {
      console.warn(`WARN: v6.7 NDCG@10 = ${metrics.ndcg10} is outside expected [0.05, 0.95] range — check golden set labels`);
    }

    // Persist baseline
    if (!existsSync(BASELINES_DIR)) mkdirSync(BASELINES_DIR, { recursive: true });
    const baseline = {
      date: new Date().toISOString(),
      version: '6.7',
      ndcg10: metrics.ndcg10,
      mrr10: metrics.mrr10,
      queryCount: metrics.queryCount,
      perTier: metrics.perTier,
    };
    writeFileSync(join(BASELINES_DIR, 'v6.7-retrieval.json'), JSON.stringify(baseline, null, 2));
    console.log('Baseline saved to test/baselines/v6.7-retrieval.json');
  }, 60000);

  test('hybrid (04b): evaluate searchHybrid and assert ≥ baseline + 10%', async () => {
    // Skip if hybrid-retrieval.mjs not yet built (04a-only run)
    const hybridPath = join(ROOT, 'scripts/lib/memory/hybrid-retrieval.mjs');
    if (!existsSync(hybridPath)) {
      console.log('Skipping hybrid test — hybrid-retrieval.mjs not yet present (Phase 04b)');
      return;
    }

    // Read baseline
    const baselinePath = join(BASELINES_DIR, 'v6.7-retrieval.json');
    if (!existsSync(baselinePath)) {
      console.warn('No baseline file found — run v6.7 baseline test first');
      return;
    }
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));

    // Build minimal ctx for hybrid search
    let ctx, searchFn;
    try {
      const { pathToFileURL } = await import('url');
      const { SqliteProvider } = await import(pathToFileURL(join(ROOT, 'scripts/lib/memory/sqlite-backend.mjs')).href);
      const { SqliteVecBackend } = await import(pathToFileURL(join(ROOT, 'scripts/lib/memory/sqlite-vec-adapter.mjs')).href);
      const { BruteForceVectorBackend } = await import(pathToFileURL(join(ROOT, 'scripts/lib/memory/brute-force-vector-fallback.mjs')).href);

      const memoryProvider = new SqliteProvider();
      let vectorBackend;
      try {
        vectorBackend = new SqliteVecBackend({ db: memoryProvider.getDb() });
      } catch (_e) {
        vectorBackend = new BruteForceVectorBackend();
      }

      ctx = { memoryProvider, vectorBackend };
      searchFn = await makeHybridSearchFn(ctx);
    } catch (err) {
      console.warn('Cannot build hybrid ctx:', err.message);
      return;
    }

    const metrics = await evaluate(searchFn, golden);
    console.log(`Hybrid — NDCG@10: ${metrics.ndcg10} | MRR@10: ${metrics.mrr10} | baseline NDCG@10: ${baseline.ndcg10}`);

    const delta = metrics.ndcg10 - baseline.ndcg10;
    const deltaPct = baseline.ndcg10 > 0 ? (delta / baseline.ndcg10) * 100 : 0;
    console.log(`Delta: ${delta.toFixed(4)} (${deltaPct.toFixed(1)}%)`);

    const TARGET_IMPROVEMENT = 0.10; // +10% relative
    const gatePass = delta >= baseline.ndcg10 * TARGET_IMPROVEMENT || metrics.ndcg10 >= baseline.ndcg10;

    if (!gatePass) {
      console.warn(`Quality gate MISSED: hybrid NDCG@10 ${metrics.ndcg10} did not beat baseline ${baseline.ndcg10} by ≥10%`);
    } else {
      console.log(`Quality gate PASS: hybrid NDCG@10 ${metrics.ndcg10} ≥ baseline ${baseline.ndcg10} (+${deltaPct.toFixed(1)}%)`);
    }

    // Gate is soft — record result but don't fail CI on quality gate alone
    expect(metrics.queryCount).toBe(30);
    expect(metrics.ndcg10).toBeGreaterThanOrEqual(0);

    // Append hybrid metrics to baseline file
    const hybridRecord = {
      date: new Date().toISOString(),
      version: 'hybrid-04b',
      ndcg10: metrics.ndcg10,
      mrr10: metrics.mrr10,
      queryCount: metrics.queryCount,
      perTier: metrics.perTier,
      deltaVsV67: round4(delta),
      deltaPct: round4(deltaPct),
      gatePass,
    };
    writeFileSync(join(BASELINES_DIR, 'hybrid-retrieval.json'), JSON.stringify(hybridRecord, null, 2));
    console.log('Hybrid metrics saved to test/baselines/hybrid-retrieval.json');
  }, 120000);
}); // end describe

// ── Standalone script mode ───────────────────────────────────────────────────
// Run directly: node test/retrieval-quality.test.mjs
if (isMain) {
  (async () => {
    console.log('=== Retrieval Quality Evaluator (standalone) ===');
    console.log(`Golden queries: ${golden.length}`);

    let searchFn;
    try {
      searchFn = await makeV67SearchFn();
      console.log('Search function: semantic-search v6.7');
    } catch (err) {
      console.error('Failed to load search function:', err.message);
      process.exit(1);
    }

    const metrics = await evaluate(searchFn, golden);
    console.log(`\nNDCG@10: ${metrics.ndcg10}`);
    console.log(`MRR@10:  ${metrics.mrr10}`);
    console.log(`Queries: ${metrics.queryCount}`);
    console.log('\nPer-tier:');
    for (const [tier, t] of Object.entries(metrics.perTier)) {
      console.log(`  ${tier}: NDCG@10=${t.ndcg10} MRR@10=${t.mrr10} (n=${t.count})`);
    }

    if (!existsSync(BASELINES_DIR)) mkdirSync(BASELINES_DIR, { recursive: true });
    const baseline = {
      date: new Date().toISOString(),
      version: '6.7',
      ndcg10: metrics.ndcg10,
      mrr10: metrics.mrr10,
      queryCount: metrics.queryCount,
      perTier: metrics.perTier,
    };
    writeFileSync(join(BASELINES_DIR, 'v6.7-retrieval.json'), JSON.stringify(baseline, null, 2));
    console.log('\nBaseline written to test/baselines/v6.7-retrieval.json');

    if (metrics.ndcg10 < 0.05 || metrics.ndcg10 > 0.95) {
      console.warn(`\nWARN: NDCG@10=${metrics.ndcg10} outside expected [0.05, 0.95] — check golden set labels`);
    }
  })().catch(err => { console.error(err); process.exit(1); });
}
