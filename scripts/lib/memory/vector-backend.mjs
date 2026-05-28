/**
 * vector-backend.mjs — Abstract interface for vector storage backends.
 *
 * All concrete implementations must extend VectorBackend and override
 * upsert(), delete(), count(), and search().
 *
 * Usage:
 *   import { VectorBackend } from './vector-backend.mjs';
 *   class MyBackend extends VectorBackend { ... }
 */

export class VectorBackend {
  /**
   * Report backend capabilities for introspection.
   * @returns {{ vector: string, dim: number, searchAvailable: boolean }}
   */
  capabilities() {
    return { vector: 'abstract', dim: 384, searchAvailable: false };
  }

  /**
   * Upsert an entity's embedding vector. Creates or replaces by name.
   * @param {string} name - Entity name (primary key)
   * @param {Float32Array} vec - 384-dim embedding vector
   * @returns {Promise<void>}
   */
  async upsert(name, vec) { // eslint-disable-line no-unused-vars
    throw new Error('VectorBackend.upsert() not implemented');
  }

  /**
   * Delete an entity's embedding by name. No-op if not found.
   * @param {string} name
   * @returns {Promise<void>}
   */
  async delete(name) { // eslint-disable-line no-unused-vars
    throw new Error('VectorBackend.delete() not implemented');
  }

  /**
   * Count total vectors stored.
   * @returns {Promise<number>}
   */
  async count() {
    throw new Error('VectorBackend.count() not implemented');
  }

  /**
   * kNN search — NOT implemented in Phase 03b (write-only).
   * Implemented in Phase 03c.
   *
   * @param {Float32Array} queryVec - 384-dim query vector
   * @param {number} topK - Number of nearest neighbours to return
   * @returns {Promise<Array<{ name: string, distance: number }>>}
   */
  async search(queryVec, topK) { // eslint-disable-line no-unused-vars
    throw new Error('VectorBackend.search() not implemented — available in Phase 03c');
  }
}
