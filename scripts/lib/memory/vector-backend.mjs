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
   * Upsert an entity's embedding vector. Creates or replaces by stable ID.
   * @param {string} entityId - Stable entity ID (primary key)
   * @param {Float32Array} vec - 384-dim embedding vector
   * @returns {Promise<void>}
   */
  async upsert(entityId, vec) { // eslint-disable-line no-unused-vars
    throw new Error('VectorBackend.upsert() not implemented');
  }

  /**
   * Delete an entity's embedding by stable ID. No-op if not found.
   * @param {string} entityId
   * @returns {Promise<void>}
   */
  async delete(entityId) { // eslint-disable-line no-unused-vars
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
   * @returns {Promise<Array<{ id: string, name?: string, distance: number }>>}
   */
  async search(queryVec, topK) { // eslint-disable-line no-unused-vars
    throw new Error('VectorBackend.search() not implemented — available in Phase 03c');
  }
}
