/**
 * Hybrid semantic search: vector similarity + keyword matching.
 * Reads embedding index from data/brain-embeddings.json (brute-force fallback).
 * When a VectorBackend is injected, uses it for kNN instead of the JSON index.
 *
 * Usage:
 *   import { search, setVectorBackend } from './semantic-search.mjs';
 *   setVectorBackend(backend);                        // optional DI
 *   const results = await search('payment webhook', { topK: 10 });
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { embed, cosineSimilarity } from './embedding-service.mjs';
import { obsText } from './parse-observation.mjs';
import { entityId } from './memory/entity-identity.mjs';

// Phase 04b: hybrid retrieval context (injected by hermit-mcp-server at boot)
/** @type {{ memoryProvider: object, vectorBackend: object, mode: string, log: Function|null }|null} */
let _hybridCtx = null;

/**
 * Inject hybrid retrieval context for delegating search() to hybrid path.
 * mode: 'hybrid' | 'bm25' | 'vector'
 * @param {{ memoryProvider: object, vectorBackend: object, mode: string, log: Function|null }} ctx
 */
export function setHybridContext(ctx) {
  _hybridCtx = ctx;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const INDEX_PATH = join(PROJECT_ROOT, 'data', 'brain-embeddings.json');
const BRAIN_PATH = join(PROJECT_ROOT, 'data', 'brain.jsonl');

// Injected VectorBackend (set at boot time by hermit-mcp-server.mjs)
/** @type {import('./memory/vector-backend.mjs').VectorBackend|null} */
let _vectorBackend = null;

// Track lazy-embed in-flight to avoid duplicate queues (entity ID → true)
const _lazyEmbedPending = new Set();

/**
 * Inject a VectorBackend for kNN search.
 * Call this once at server boot before handling any queries.
 * @param {import('./memory/vector-backend.mjs').VectorBackend|null} backend
 */
export function setVectorBackend(backend) {
  _vectorBackend = backend;
}

/**
 * Load embedding index from disk (legacy brute-force path).
 * @returns {{ meta: object, entities: object }|null}
 */
function loadIndex() {
  if (!existsSync(INDEX_PATH)) return null;
  try {
    return JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  } catch { return null; }
}

/**
 * Load entities from brain.jsonl for keyword matching and hydration.
 * @returns {Map<string, object>} stable entity ID → entity
 */
function loadEntities() {
  if (!existsSync(BRAIN_PATH)) return new Map();
  const lines = readFileSync(BRAIN_PATH, 'utf-8').split('\n').filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'entity') map.set(entityId(obj), obj);
    } catch { /* skip */ }
  }
  return map;
}

/**
 * Simple BM25-style keyword matching score.
 * @param {string} query
 * @param {string} entityText
 * @returns {number} Score in [0, 1]
 */
function keywordScore(query, entityText) {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (queryTerms.length === 0) return 0;
  const textLower = entityText.toLowerCase();
  let matchCount = 0;
  for (const term of queryTerms) {
    if (textLower.includes(term)) matchCount++;
  }
  return matchCount / queryTerms.length;
}

/** Build searchable text from entity (for keyword matching). */
function entitySearchText(entity) {
  const obs = (entity.observations || []).map(o => obsText(o)).filter(Boolean);
  return [entity.name, entity.entityType, ...obs].join(' ');
}

/**
 * Schedule a lazy embed+upsert for an entity missing from the vector backend.
 * Non-blocking: fires via setImmediate, never awaited in the search hot path.
 * Uses _lazyEmbedPending to prevent duplicate concurrent embeds for the same ID.
 * Vector writes go directly to SQLite — no JSONL lock needed.
 * Latency note: embedding takes ~100ms/entity; runs out-of-band so search is unaffected.
 *
 * @param {string} id
 * @param {object} entity
 */
function scheduleLazyEmbed(id, entity) {
  if (!_vectorBackend || _lazyEmbedPending.has(id)) return;
  _lazyEmbedPending.add(id);

  setImmediate(async () => {
    try {
      const text = entitySearchText(entity);
      const vec = await embed(text);
      if (!vec) return; // model unavailable

      await _vectorBackend.upsert(id, vec);
    } catch (_err) {
      // Non-fatal: lazy embed failure is expected (model error, DB locked transiently).
      // The pending flag is cleared so the next query can retry.
    } finally {
      _lazyEmbedPending.delete(id);
    }
  });
}

/**
 * Search using injected VectorBackend (kNN path).
 * Over-fetches topK*2, then blends with keyword score.
 *
 * @param {string} query
 * @param {Map<string, object>} entities
 * @param {object} opts
 * @returns {Promise<Array<{name, entityType, score, vectorScore, keywordScore, observationCount}>>}
 */
async function searchViaBackend(query, entities, opts) {
  const { topK, vectorWeight, keywordWeight, minScore } = opts;

  const qvec = await embed(query);
  if (!qvec) {
    // Model unavailable — fall through to keyword-only
    return null;
  }

  // Over-fetch to ensure sufficient candidates after keyword blending
  const fetchK = Math.min(topK * 2, 100);
  let vecResults;
  try {
    vecResults = await _vectorBackend.search(qvec, fetchK);
  } catch (err) {
    // Backend error — caller falls back to brute-force
    return null;
  }

  // Build a map from vec results for O(1) lookup
  const vecDistMap = new Map(vecResults.map(r => [r.id || r.name, r.distance]));

  // Schedule lazy embeds for entities NOT in backend
  const backendCount = await _vectorBackend.count();
  if (backendCount > 0) {
    for (const [id, entity] of entities) {
      if (!vecDistMap.has(id)) {
        scheduleLazyEmbed(id, entity);
      }
    }
  }

  const results = [];

  // Score entities that appeared in vector results
  for (const result of vecResults) {
    const id = result.id || result.name;
    const distance = result.distance;
    const entity = entities.get(id);
    if (!entity) continue; // not in current brain (stale vector entry)

    // Convert distance to similarity: distance=0 → sim=1, distance=2 → sim=0
    const vecScore = Math.max(0, 1 - distance);
    const searchText = entitySearchText(entity);
    const kwScore = keywordScore(query, searchText);
    const score = (vectorWeight * vecScore) + (keywordWeight * kwScore);

    if (score >= minScore) {
      results.push({
        id,
        name: entity.name,
        entityType: entity.entityType,
        score: Math.round(score * 1000) / 1000,
        vectorScore: Math.round(vecScore * 1000) / 1000,
        keywordScore: Math.round(kwScore * 1000) / 1000,
        observationCount: (entity.observations || []).length,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Brute-force search using JSON embedding index (legacy / fallback path).
 * @param {string} query
 * @param {Map<string, object>} entities
 * @param {object} opts
 * @returns {Promise<Array>}
 */
async function searchBruteForce(query, entities, opts) {
  const { topK, vectorWeight, keywordWeight, minScore } = opts;

  const index = loadIndex();
  const queryVector = index ? await embed(query) : null;
  const useVector = queryVector !== null && index !== null;

  const results = [];

  for (const [id, entity] of entities) {
    const searchText = entitySearchText(entity);
    const kwScore = keywordScore(query, searchText);

    let vecScore = 0;
    const cached = index?.entities[id] || index?.entities[entity.name];
    if (useVector && cached?.vector) {
      const entityVec = new Float32Array(cached.vector);
      vecScore = Math.max(0, cosineSimilarity(queryVector, entityVec));
    }

    const score = useVector
      ? (vectorWeight * vecScore) + (keywordWeight * kwScore)
      : kwScore;

    if (score >= minScore) {
      results.push({
        id,
        name: entity.name,
        entityType: entity.entityType,
        score: Math.round(score * 1000) / 1000,
        vectorScore: Math.round(vecScore * 1000) / 1000,
        keywordScore: Math.round(kwScore * 1000) / 1000,
        observationCount: (entity.observations || []).length,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Hybrid semantic search combining vector similarity + keyword matching.
 * When a VectorBackend is injected, uses kNN. Otherwise falls back to JSON index.
 *
 * @param {string} query - Natural language search query
 * @param {object} options
 * @param {number} options.topK - Max results (default 10)
 * @param {number} options.vectorWeight - Weight for vector similarity (default 0.7)
 * @param {number} options.keywordWeight - Weight for keyword matching (default 0.3)
 * @param {number} options.minScore - Minimum score threshold (default 0.1)
 * @returns {Promise<Array<{ name: string, entityType: string, score: number, vectorScore: number, keywordScore: number, observationCount: number }>>}
 */
export async function search(query, options = {}) {
  const {
    topK = 10,
    vectorWeight = 0.7,
    keywordWeight = 0.3,
    minScore = 0.1,
  } = options;

  if (!query || !query.trim()) return [];

  // Phase 04b: delegate to hybrid path when mode=hybrid
  if (_hybridCtx && _hybridCtx.mode === 'hybrid') {
    try {
      const { searchHybrid } = await import('./memory/hybrid-retrieval.mjs');
      if (_hybridCtx.log) {
        _hybridCtx.log(`[retrieval] mode=hybrid query="${query.slice(0, 60)}"`);
      }
      const results = await searchHybrid(query, _hybridCtx, { topK });
      if (results && results.length > 0) return results;
      // Fall through to legacy on empty result (e.g. no BM25 index yet)
    } catch (_err) {
      // Fall through to legacy path on any hybrid error
    }
  }

  const entities = loadEntities();
  if (entities.size === 0) return [];

  const opts = { topK, vectorWeight, keywordWeight, minScore };

  // Primary path: injected VectorBackend (sqlite-vec or brute-force)
  if (_vectorBackend) {
    try {
      const results = await searchViaBackend(query, entities, opts);
      if (results !== null) return results;
    } catch (_err) {
      // Fall through to legacy path
    }
  }

  // Fallback: legacy JSON index brute-force
  return searchBruteForce(query, entities, opts);
}

/**
 * Check if semantic search is available.
 * @returns {{ vectorSearch: boolean, keywordSearch: boolean, indexEntityCount: number, backendType?: string }}
 */
export function searchStatus() {
  const index = loadIndex();
  const status = {
    vectorSearch: _vectorBackend !== null || index !== null,
    keywordSearch: true,
    indexEntityCount: index ? Object.keys(index.entities).length : 0,
    indexModel: index?.meta?.model || null,
    indexBuiltAt: index?.meta?.builtAt || null,
    retrievalMode: _hybridCtx?.mode || 'bm25',
  };
  if (_vectorBackend) {
    status.backendType = _vectorBackend.capabilities().vector;
  }
  return status;
}

export { loadIndex, loadEntities };
