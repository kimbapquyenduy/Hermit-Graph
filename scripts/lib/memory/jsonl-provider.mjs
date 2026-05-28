/**
 * JsonlProvider — MemoryProvider adapter wrapping existing brain-io + semantic-search.
 * Zero behavior change vs v6.7. All I/O delegates to the original modules.
 *
 * Usage:
 *   const provider = new JsonlProvider({ brainPath: '/path/to/brain.jsonl' });
 *   const { entities, relations } = await provider.readAll();
 */

import { readBrain, writeBrain, withBrainLock } from '../brain-io.mjs';
import { search as semanticSearch } from '../semantic-search.mjs';
import { MemoryProvider } from './provider-interface.mjs';

export class JsonlProvider extends MemoryProvider {
  /**
   * @param {{ brainPath: string }} options
   */
  constructor({ brainPath }) {
    super();
    if (!brainPath) throw new Error('JsonlProvider: brainPath is required');
    this._brainPath = brainPath;
  }

  /**
   * Feature flags for this backend.
   * - keyword: always available (in-memory BM25-style scan)
   * - vector: 'index-based' (requires brain-embeddings.json pre-built by build:index)
   * - fts5: false (JSONL has no SQL FTS5)
   * @returns {{ keyword: boolean, vector: string|boolean, fts5: boolean }}
   */
  capabilities() {
    return { keyword: true, vector: 'index-based', fts5: false };
  }

  /**
   * Read entire brain. Mtime-cached by brain-io (no redundant disk reads).
   * @returns {Promise<{ entities: Map<string, object>, relations: object[] }>}
   */
  async readAll() {
    return readBrain(this._brainPath);
  }

  /**
   * Upsert a single entity. MUST be called inside withLock().
   * Re-reads the full brain, sets entity, and writes back atomically.
   * @param {object} entity
   * @returns {Promise<void>}
   */
  async writeEntity(entity) {
    const { entities, relations } = readBrain(this._brainPath);
    entities.set(entity.name, entity);
    writeBrain(this._brainPath, entities, relations);
  }

  /**
   * Append a single relation. MUST be called inside withLock().
   * Skips exact duplicates (same from/to/relationType).
   * @param {object} relation
   * @returns {Promise<void>}
   */
  async writeRelation(relation) {
    const { entities, relations } = readBrain(this._brainPath);
    const exists = relations.some(
      r => r.from === relation.from && r.to === relation.to && r.relationType === relation.relationType
    );
    if (!exists) {
      relations.push({ type: 'relation', ...relation });
      writeBrain(this._brainPath, entities, relations);
    }
  }

  /**
   * Hard-delete entity by name (case-insensitive). MUST be called inside withLock().
   * @param {string} name
   * @returns {Promise<boolean>}
   */
  async deleteEntity(name) {
    const { entities, relations } = readBrain(this._brainPath);
    const lower = name.toLowerCase();
    let deleted = false;
    for (const [k] of entities) {
      if (k.toLowerCase() === lower) {
        entities.delete(k);
        deleted = true;
        break;
      }
    }
    if (deleted) writeBrain(this._brainPath, entities, relations);
    return deleted;
  }

  /**
   * Look up single entity by name (case-insensitive). Lock-free.
   * @param {string} name
   * @returns {Promise<object|null>}
   */
  async getEntity(name) {
    const { entities } = readBrain(this._brainPath);
    const lower = name.toLowerCase();
    for (const [k, v] of entities) {
      if (k.toLowerCase() === lower) return v;
    }
    return null;
  }

  /**
   * Keyword search — delegates to memory-module's inline keywordMatch logic.
   * Re-implemented here so provider is self-contained; same algorithm.
   * @param {string} query
   * @param {{ topK?: number, minScore?: number }} [opts]
   * @returns {Promise<Array<{ name: string, entityType: string, score: number }>>}
   */
  async searchKeyword(query, opts = {}) {
    const { topK = 10, minScore = 0 } = opts;
    const { entities } = readBrain(this._brainPath);
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (!terms.length) return [];

    const results = [];
    for (const [, entity] of entities) {
      if (entity._archived) continue;
      const text = [entity.name, entity.entityType, ...(entity.observations || []).map(o =>
        typeof o === 'string' ? o : (o?.content || '')
      )].join(' ').toLowerCase();
      let hits = 0;
      for (const t of terms) { if (text.includes(t)) hits++; }
      const score = hits / terms.length;
      if (score > minScore) results.push({ name: entity.name, entityType: entity.entityType, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Vector + keyword hybrid search — delegates to semantic-search.mjs.
   * Falls back to keyword-only when embedding index is absent.
   * @param {string} query
   * @param {{ topK?: number, minScore?: number, vectorWeight?: number, keywordWeight?: number }} [opts]
   * @returns {Promise<Array<{ name: string, entityType: string, score: number, vectorScore: number, keywordScore: number }>>}
   */
  async searchVector(query, opts = {}) {
    return semanticSearch(query, opts);
  }

  /**
   * Acquire exclusive write lock on brain.jsonl, execute fn, release lock.
   * @param {Function} fn
   * @returns {Promise<*>}
   */
  async withLock(fn) {
    return withBrainLock(this._brainPath, fn);
  }
}
