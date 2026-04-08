/**
 * Hybrid semantic search: vector similarity + keyword matching.
 * Reads embedding index from data/brain-embeddings.json.
 * Falls back to keyword-only search if index or model unavailable.
 *
 * Usage:
 *   import { search } from './semantic-search.mjs';
 *   const results = await search('payment webhook', { topK: 10 });
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { embed, cosineSimilarity } from './embedding-service.mjs';
import { obsText } from './parse-observation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const INDEX_PATH = join(PROJECT_ROOT, 'data', 'brain-embeddings.json');
const BRAIN_PATH = join(PROJECT_ROOT, 'data', 'brain.jsonl');

/**
 * Load embedding index from disk.
 * @returns {{ meta: object, entities: object }|null}
 */
function loadIndex() {
  if (!existsSync(INDEX_PATH)) return null;
  try {
    return JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  } catch { return null; }
}

/**
 * Load entities from brain.jsonl for keyword matching.
 * @returns {Map<string, object>} name → entity
 */
function loadEntities() {
  if (!existsSync(BRAIN_PATH)) return new Map();
  const lines = readFileSync(BRAIN_PATH, 'utf-8').split('\n').filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'entity') map.set(obj.name, obj);
    } catch { /* skip */ }
  }
  return map;
}

/**
 * Simple BM25-style keyword matching score.
 * Counts query term occurrences in entity text, normalized by text length.
 * @param {string} query - Search query
 * @param {string} entityText - Entity name + type + observations
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

/**
 * Build searchable text from entity (for keyword matching).
 */
function entitySearchText(entity) {
  const obs = (entity.observations || []).map(o => obsText(o)).filter(Boolean);
  return [entity.name, entity.entityType, ...obs].join(' ');
}

/**
 * Hybrid semantic search combining vector similarity + keyword matching.
 * @param {string} query - Natural language search query
 * @param {object} options
 * @param {number} options.topK - Max results to return (default 10)
 * @param {number} options.vectorWeight - Weight for vector similarity (default 0.7)
 * @param {number} options.keywordWeight - Weight for keyword matching (default 0.3)
 * @param {number} options.minScore - Minimum score threshold (default 0.1)
 * @returns {Promise<Array<{ name: string, entityType: string, score: number, vectorScore: number, keywordScore: number }>>}
 */
export async function search(query, options = {}) {
  const {
    topK = 10,
    vectorWeight = 0.7,
    keywordWeight = 0.3,
    minScore = 0.1,
  } = options;

  if (!query || !query.trim()) return [];

  const entities = loadEntities();
  if (entities.size === 0) return [];

  // Try vector search
  const index = loadIndex();
  const queryVector = index ? await embed(query) : null;
  const useVector = queryVector !== null && index !== null;

  const results = [];

  for (const [name, entity] of entities) {
    const searchText = entitySearchText(entity);
    const kwScore = keywordScore(query, searchText);

    let vecScore = 0;
    if (useVector && index.entities[name]?.vector) {
      const entityVec = new Float32Array(index.entities[name].vector);
      vecScore = Math.max(0, cosineSimilarity(queryVector, entityVec));
    }

    // Hybrid score
    const score = useVector
      ? (vectorWeight * vecScore) + (keywordWeight * kwScore)
      : kwScore; // fallback: keyword-only

    if (score >= minScore) {
      results.push({
        name,
        entityType: entity.entityType,
        score: Math.round(score * 1000) / 1000,
        vectorScore: Math.round(vecScore * 1000) / 1000,
        keywordScore: Math.round(kwScore * 1000) / 1000,
        observationCount: (entity.observations || []).length,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Check if semantic search is available (index exists + model loadable).
 * @returns {{ vectorSearch: boolean, keywordSearch: boolean, indexEntityCount: number }}
 */
export function searchStatus() {
  const index = loadIndex();
  return {
    vectorSearch: index !== null,
    keywordSearch: true, // always available
    indexEntityCount: index ? Object.keys(index.entities).length : 0,
    indexModel: index?.meta?.model || null,
    indexBuiltAt: index?.meta?.builtAt || null,
  };
}

export { loadIndex, loadEntities };
