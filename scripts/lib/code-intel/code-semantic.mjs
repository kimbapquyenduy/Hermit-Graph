/**
 * Semantic search for code symbols — embedding-based retrieval.
 * Uses the same all-MiniLM-L6-v2 model as the KG side (semantic-search.mjs).
 *
 * Embedding input per symbol: "<name> <kind> <file-stem> called-by:<callers> calls:<callees>"
 * Storage: <dataDir>/code-embeddings.json (symbolId -> Float32Array[384])
 * Build strategy: lazy — first semantic query triggers build, cached on disk after.
 * Staleness: rebuilds new symbols only; old symbols keep their existing vectors.
 */

import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { embedBatch, embed, cosineSimilarity } from '../embedding-service.mjs';
import { readCodeGraph, codeGraphPath } from './code-io.mjs';

const EMBEDDING_FILE = 'code-embeddings.json';

export function codeEmbeddingsPath(dataDir) {
  return join(dataDir, EMBEDDING_FILE);
}

/** Compose the text we embed for a single symbol. Includes neighborhood context. */
function symbolEmbedText(symbol, graph) {
  const parts = [
    symbol.name,
    symbol.kind || '',
    basename(symbol.file || '').replace(/\.[^.]+$/, ''),
  ];
  const callers = graph.getCallers?.(symbol.id) || [];
  if (callers.length) parts.push('called-by', ...callers.slice(0, 3).map(c => c.name));
  const callees = graph.getCallees?.(symbol.id) || [];
  if (callees.length) parts.push('calls', ...callees.slice(0, 3).map(c => c.name));
  return parts.filter(Boolean).join(' ');
}

/** True if embeddings file is older than code-symbols.jsonl (or missing). */
export function isStale(dataDir) {
  const embPath = codeEmbeddingsPath(dataDir);
  const graphPath = codeGraphPath(dataDir);
  if (!existsSync(embPath)) return true;
  if (!existsSync(graphPath)) return false;
  try {
    const embMtime = statSync(embPath).mtime.getTime();
    const graphMtime = statSync(graphPath).mtime.getTime();
    return graphMtime > embMtime;
  } catch {
    return true;
  }
}

/** Load embedding map from disk. Returns empty Map if missing/corrupt. */
export function loadCodeEmbeddings(dataDir) {
  const path = codeEmbeddingsPath(dataDir);
  if (!existsSync(path)) return new Map();
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const map = new Map();
    for (const [id, arr] of Object.entries(data)) {
      map.set(id, new Float32Array(arr));
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Build/refresh embeddings for all symbols. Incrementally skips already-embedded IDs.
 * Throws if the embedding model fails to load (caller should fall back to keyword-only).
 */
export async function buildCodeEmbeddings(dataDir, { onProgress } = {}) {
  const graph = readCodeGraph(dataDir);
  const symbols = [...graph.symbols.values()];
  if (!symbols.length) return { vectors: new Map(), built: 0, skipped: 0 };

  const existing = loadCodeEmbeddings(dataDir);
  const texts = [];
  const idsToEmbed = [];
  for (const s of symbols) {
    if (existing.has(s.id)) continue;
    texts.push(symbolEmbedText(s, graph));
    idsToEmbed.push(s.id);
  }

  // Drop embeddings for symbols that no longer exist
  const vectors = new Map();
  const validIds = new Set(symbols.map(s => s.id));
  for (const [id, vec] of existing) {
    if (validIds.has(id)) vectors.set(id, vec);
  }

  if (texts.length === 0) {
    return { vectors, built: 0, skipped: symbols.length };
  }

  onProgress?.({ phase: 'embedding', total: texts.length });
  const embedded = await embedBatch(texts);
  if (!embedded) {
    throw new Error('Embedding model unavailable');
  }
  for (let i = 0; i < idsToEmbed.length; i++) {
    vectors.set(idsToEmbed[i], embedded[i]);
  }

  const out = {};
  for (const [id, vec] of vectors) {
    out[id] = Array.from(vec);
  }
  writeFileSync(codeEmbeddingsPath(dataDir), JSON.stringify(out), 'utf8');

  return { vectors, built: texts.length, skipped: symbols.length - texts.length };
}

/**
 * Hybrid semantic + keyword search. Vector weight 0.7, keyword weight 0.3.
 * Falls back to keyword-only (tokenized overlap) if embeddings unavailable.
 */
export async function searchCodeSemantic(query, dataDir, opts = {}) {
  const {
    topK = 20,
    vectorWeight = 0.7,
    keywordWeight = 0.3,
    minScore = 0.15,
    autoBuild = true,
  } = opts;

  const graph = readCodeGraph(dataDir);
  if (!graph.symbols.size) return [];

  let vectors = loadCodeEmbeddings(dataDir);
  if (autoBuild && (vectors.size === 0 || isStale(dataDir))) {
    try {
      const res = await buildCodeEmbeddings(dataDir);
      vectors = res.vectors;
    } catch {
      // Model unavailable — proceed with keyword-only
    }
  }

  const queryVec = await embed(query).catch(() => null);
  const useVector = queryVec !== null && vectors.size > 0;

  const queryTokens = query.toLowerCase().split(/[\s_-]+/).filter(t => t.length > 1);

  const results = [];
  for (const s of graph.symbols.values()) {
    const hay = (s.name + ' ' + s.id).toLowerCase();
    let kwHits = 0;
    for (const t of queryTokens) if (hay.includes(t)) kwHits++;
    const kwScore = queryTokens.length ? kwHits / queryTokens.length : 0;

    let vecScore = 0;
    if (useVector) {
      const vec = vectors.get(s.id);
      if (vec) vecScore = Math.max(0, cosineSimilarity(queryVec, vec));
    }

    const score = useVector
      ? (vectorWeight * vecScore) + (keywordWeight * kwScore)
      : kwScore;

    if (score >= minScore) {
      results.push({ symbol: s, vectorScore: vecScore, keywordScore: kwScore, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}
