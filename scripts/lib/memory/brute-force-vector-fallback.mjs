/**
 * brute-force-vector-fallback.mjs — In-memory kNN fallback when sqlite-vec unavailable.
 *
 * BruteForceVectorBackend extends VectorBackend with linear cosine scan.
 * Identical return shape to SqliteVecBackend.search: [{name, distance}].
 * Distance = 1 - cosine_similarity (lower = closer).
 *
 * Usage:
 *   import { BruteForceVectorBackend } from './brute-force-vector-fallback.mjs';
 *   const backend = new BruteForceVectorBackend();
 *   await backend.addAll(entries); // entries: [{name, vec}]
 *   const results = await backend.search(queryVec, 10);
 */

import { VectorBackend } from './vector-backend.mjs';

const EMBEDDING_DIM = 384;
const MAX_TOPK = 100;

/**
 * Compute cosine distance (1 - similarity) between two normalized Float32Arrays.
 * For normalized vectors: cosine_similarity = dot product.
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} distance in [0, 2]
 */
function cosineDistance(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  // Clamp to avoid floating-point edge cases
  return 1 - Math.min(1, Math.max(-1, dot));
}

export class BruteForceVectorBackend extends VectorBackend {
  /**
   * @param {Array<{name: string, vec: Float32Array}>} [initialEntries] - Optional pre-load
   */
  constructor(initialEntries = []) {
    super();
    /** @type {Map<string, Float32Array>} */
    this._store = new Map();

    for (const { name, vec } of initialEntries) {
      this._validateAndStore(name, vec);
    }
  }

  /** @returns {{ vector: string, dim: number, searchAvailable: boolean }} */
  capabilities() {
    return { vector: 'brute-force', dim: EMBEDDING_DIM, searchAvailable: true };
  }

  /**
   * Validate and store a vector. Shared by constructor + upsert.
   * @param {string} name
   * @param {Float32Array} vec
   */
  _validateAndStore(name, vec) {
    if (!name) throw new Error('BruteForceVectorBackend: name is required');
    if (!(vec instanceof Float32Array)) {
      throw new Error(`BruteForceVectorBackend: vec must be Float32Array, got ${typeof vec}`);
    }
    if (vec.length !== EMBEDDING_DIM) {
      throw new Error(`BruteForceVectorBackend: expected ${EMBEDDING_DIM}-dim vector, got ${vec.length}`);
    }
    this._store.set(name, vec);
  }

  /**
   * Bulk-load entries. Idempotent — overwrites existing names.
   * @param {Array<{name: string, vec: Float32Array}>} entries
   * @returns {Promise<void>}
   */
  async addAll(entries) {
    for (const { name, vec } of entries) {
      this._validateAndStore(name, vec);
    }
  }

  /**
   * Upsert an entity's embedding.
   * @param {string} name
   * @param {Float32Array} vec - Must be 384-dim
   * @returns {Promise<void>}
   */
  async upsert(name, vec) {
    this._validateAndStore(name, vec);
  }

  /**
   * Delete an entity. No-op if not found.
   * @param {string} name
   * @returns {Promise<void>}
   */
  async delete(name) {
    this._store.delete(name);
  }

  /**
   * Count total vectors in memory.
   * @returns {Promise<number>}
   */
  async count() {
    return this._store.size;
  }

  /**
   * Linear kNN search via cosine distance.
   * @param {Float32Array} queryVec - 384-dim query vector
   * @param {number} topK - Results to return (capped at 100)
   * @returns {Promise<Array<{name: string, distance: number}>>}
   */
  async search(queryVec, topK = 10) {
    if (!(queryVec instanceof Float32Array)) {
      throw new Error(`BruteForceVectorBackend.search: queryVec must be Float32Array, got ${typeof queryVec}`);
    }
    if (queryVec.length !== EMBEDDING_DIM) {
      throw new Error(`BruteForceVectorBackend.search: expected ${EMBEDDING_DIM}-dim vector, got ${queryVec.length}`);
    }
    const k = Math.min(Math.max(1, topK), MAX_TOPK);

    const scored = [];
    for (const [name, vec] of this._store) {
      scored.push({ name, distance: cosineDistance(queryVec, vec) });
    }

    // Partial sort — only fully sort if k is large relative to store size
    scored.sort((a, b) => a.distance - b.distance);
    return scored.slice(0, k);
  }
}
