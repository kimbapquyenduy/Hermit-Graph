/**
 * MemoryProvider — abstract base class for all brain storage backends.
 * Subclasses: JsonlProvider (Phase 00), SqliteProvider (Phase 01), PluginProvider (Phase 06).
 *
 * Contract:
 *   - Construction is sync; all I/O methods are async.
 *   - Writes MUST be wrapped in withLock() for atomicity.
 *   - capabilities() is sync, returns feature flags for caller-side branching.
 */

export class MemoryProvider {
  /**
   * Return feature flags for this backend.
   * Callers check capabilities before using optional methods (searchVector, FTS5).
   * @returns {{ keyword: boolean, vector: boolean|string, fts5: boolean }}
   */
  capabilities() {
    throw new Error('not implemented');
  }

  /**
   * Read entire brain: all entities and relations.
   * Lock-free — safe for concurrent reads.
   * @returns {Promise<{ entities: Map<string, object>, relations: object[] }>}
   */
  async readAll() {
    throw new Error('not implemented');
  }

  /**
   * Persist (upsert) a single entity. Must be called inside withLock().
   * @param {object} entity - { type:'entity', name, entityType, observations, ... }
   * @returns {Promise<void>}
   */
  async writeEntity(entity) {
    throw new Error('not implemented');
  }

  /**
   * Persist a single relation. Must be called inside withLock().
   * @param {object} relation - { type:'relation', from, to, relationType }
   * @returns {Promise<void>}
   */
  async writeRelation(relation) {
    throw new Error('not implemented');
  }

  /**
   * Hard-delete an entity (and its observations) by name.
   * For soft-delete, callers should writeEntity with _archived=true.
   * Must be called inside withLock().
   * @param {string} name
   * @returns {Promise<boolean>} true if entity existed and was deleted
   */
  async deleteEntity(name) {
    throw new Error('not implemented');
  }

  /**
   * Look up a single entity by exact name (case-insensitive).
   * Lock-free — safe for concurrent reads.
   * @param {string} name
   * @returns {Promise<object|null>}
   */
  async getEntity(name) {
    throw new Error('not implemented');
  }

  /**
   * Keyword (BM25-style) search across entity names, types, and observations.
   * @param {string} query
   * @param {{ topK?: number, minScore?: number }} [opts]
   * @returns {Promise<Array<{ name: string, entityType: string, score: number }>>}
   */
  async searchKeyword(query, opts) {
    throw new Error('not implemented');
  }

  /**
   * Vector (embedding) search. Only available if capabilities().vector is truthy.
   * Throws if backend does not support vector search.
   * @param {string} query
   * @param {{ topK?: number, minScore?: number, vectorWeight?: number, keywordWeight?: number }} [opts]
   * @returns {Promise<Array<{ name: string, entityType: string, score: number, vectorScore: number, keywordScore: number }>>}
   */
  async searchVector(query, opts) {
    throw new Error('not implemented');
  }

  /**
   * Execute fn while holding exclusive write lock on the underlying store.
   * All mutating methods (writeEntity, writeRelation, deleteEntity) must be
   * called inside a withLock callback.
   * @param {Function} fn - sync or async callback; receives no arguments
   * @returns {Promise<*>} resolves with fn's return value
   */
  async withLock(fn) {
    throw new Error('not implemented');
  }
}
