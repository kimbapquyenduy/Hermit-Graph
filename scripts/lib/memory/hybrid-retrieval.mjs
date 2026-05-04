/**
 * hybrid-retrieval.mjs — Hybrid BM25 + vector search fused with RRF.
 *
 * Orchestrates parallel retrieval from two backends and fuses results via RRF.
 * Query-length routing biases BM25 for short queries, vector for long ones.
 *
 * @module hybrid-retrieval
 */

import { rrf } from './rrf-fusion.mjs';
import { embed } from '../embedding-service.mjs';

/** Hard cap on topK per spec. */
const TOP_K_MAX = 50;

/** Per-backend timeout in ms. If vector exceeds this, returns BM25-only. */
const VECTOR_TIMEOUT_MS = 80;

/**
 * Count whitespace-delimited tokens in a query string.
 * @param {string} query
 * @returns {number}
 */
function tokenCount(query) {
  return query.trim().split(/\s+/).filter(t => t.length > 0).length;
}

/**
 * Determine per-ranker k values based on query length.
 * Short (≤2 tokens): bias keyword (lower k = stronger BM25 rank pressure).
 * Long (≥5 tokens): bias vector (lower k = stronger vector rank pressure).
 * Medium: balanced k=60.
 *
 * @param {number} tokens
 * @returns {{ bm25K: number, vectorK: number }}
 */
function routeK(tokens) {
  if (tokens <= 2) return { bm25K: 30, vectorK: 120 };
  if (tokens >= 5) return { bm25K: 120, vectorK: 30 };
  return { bm25K: 60, vectorK: 60 };
}

/**
 * Run a promise with a timeout. Resolves with { ok: true, value } or { ok: false }.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<{ok: boolean, value?: T}>}
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise.then(value => ({ ok: true, value })),
    new Promise(resolve => setTimeout(() => resolve({ ok: false }), ms)),
  ]);
}

/**
 * Hybrid search: BM25 + vector in parallel, fused with RRF.
 *
 * Returns the same shape as semantic-search.search():
 *   [{ name, entityType, score, vectorScore?, keywordScore?, observationCount }]
 *
 * @param {string} query - Natural language search query
 * @param {{
 *   memoryProvider: import('./provider-interface.mjs').MemoryProvider,
 *   vectorBackend: import('./vector-backend.mjs').VectorBackend|null,
 * }} ctx
 * @param {{
 *   topK?: number,
 *   k?: number,        // Override both BM25 and vector k (bypasses routing)
 *   bm25K?: number,    // Override BM25 k only
 *   vectorK?: number,  // Override vector k only
 * }} [opts]
 * @returns {Promise<Array<{
 *   name: string,
 *   entityType: string,
 *   score: number,
 *   vectorScore?: number,
 *   keywordScore?: number,
 *   observationCount: number,
 *   _vectorFallback?: boolean,
 * }>>}
 */
export async function searchHybrid(query, ctx, opts = {}) {
  if (!query || !query.trim()) return [];

  const { memoryProvider, vectorBackend } = ctx;
  if (!memoryProvider) return [];

  const topK = Math.min(opts.topK ?? 10, TOP_K_MAX);
  const tokens = tokenCount(query);
  const routed = routeK(tokens);
  const bm25K = opts.k ?? opts.bm25K ?? routed.bm25K;
  const vectorK = opts.k ?? opts.vectorK ?? routed.vectorK;
  // Fetch extra candidates before fusion, then trim to topK
  const fetchK = Math.min(topK * 3, TOP_K_MAX);

  // ── BM25 retrieval ───────────────────────────────────────────────────────
  let bm25Results = [];
  try {
    const raw = await memoryProvider.searchKeyword(query, { topK: fetchK });
    bm25Results = (raw || []).map(r => ({ name: r.name, _entityType: r.entityType, _obsCount: r.observationCount }));
  } catch (_err) {
    // Non-fatal: proceed with empty BM25 list
  }

  // ── Vector retrieval (with timeout) ─────────────────────────────────────
  let vectorResults = [];
  let vectorFallback = false;

  if (vectorBackend) {
    try {
      const qvec = await embed(query);
      if (qvec) {
        const vecPromise = vectorBackend.search(qvec, fetchK);
        const { ok, value } = await withTimeout(vecPromise, VECTOR_TIMEOUT_MS);
        if (ok && Array.isArray(value)) {
          vectorResults = value.map(r => ({ name: r.name }));
        } else {
          vectorFallback = true;
        }
      }
    } catch (_err) {
      vectorFallback = true;
    }
  }

  // ── RRF fusion ───────────────────────────────────────────────────────────
  const fused = rrf([bm25Results, vectorResults], { k: vectorFallback ? bm25K : Math.round((bm25K + vectorK) / 2), topK });

  // ── Build score maps for secondary fields ────────────────────────────────
  const bm25ScoreMap = new Map(bm25Results.map((r, i) => [r.name, 1 - i / Math.max(bm25Results.length, 1)]));
  const vecScoreMap = new Map(vectorResults.map((r, i) => [r.name, 1 - i / Math.max(vectorResults.length, 1)]));
  // Build entity-type + obsCount lookup from BM25 results (already hydrated)
  const metaMap = new Map(bm25Results.map(r => [r.name, { entityType: r._entityType, observationCount: r._obsCount }]));

  // ── Hydrate missing metadata via memoryProvider.getEntity ───────────────
  const hydrateNames = fused.filter(r => !metaMap.has(r.name)).map(r => r.name);
  if (hydrateNames.length > 0) {
    await Promise.all(hydrateNames.map(async (name) => {
      try {
        const entity = await memoryProvider.getEntity(name);
        if (entity) {
          metaMap.set(name, {
            entityType: entity.entityType,
            observationCount: (entity.observations || []).length,
          });
        }
      } catch (_err) { /* skip missing */ }
    }));
  }

  return fused.map(r => {
    const meta = metaMap.get(r.name) || { entityType: 'unknown', observationCount: 0 };
    const result = {
      name: r.name,
      entityType: meta.entityType,
      score: Math.round(r.score * 10000) / 10000,
      observationCount: meta.observationCount ?? 0,
    };
    if (bm25ScoreMap.has(r.name)) result.keywordScore = Math.round(bm25ScoreMap.get(r.name) * 1000) / 1000;
    if (vecScoreMap.has(r.name)) result.vectorScore = Math.round(vecScoreMap.get(r.name) * 1000) / 1000;
    if (vectorFallback) result._vectorFallback = true;
    return result;
  });
}
