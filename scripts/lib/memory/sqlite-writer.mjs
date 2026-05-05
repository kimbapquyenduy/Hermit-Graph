/**
 * sqlite-writer.mjs — Single-source-of-truth writer: SQLite + vec_entities only.
 * Phase 08: dropped JSONL fan-out entirely. SQLite is now authoritative.
 *
 * Usage:
 *   const writer = new SqliteWriter({ sqliteProvider, vectorBackend });
 *   await writer.writeBoth({ entities: [...], relations: [...] });
 *
 * Failure contract:
 *   - SQLite throws → propagate (SQLite is authoritative)
 *   - Vector upsert throws → log warning, increment counter, swallow (vec is non-fatal)
 *   - HERMIT_EMBED_MODE=eager (default) → embed on every write
 *   - HERMIT_EMBED_MODE=lazy → skip embed here; deferred to first search miss
 *
 * Escape hatch:
 *   HERMIT_LEGACY_DUAL_WRITE=1 → instantiate old DualWriter behavior (also writes JSONL).
 *   For users migrating who need dual-write temporarily.
 *   Marked for removal in v8.0.
 */

import { embed } from '../embedding-service.mjs';

/**
 * @typedef {import('./provider-interface.mjs').MemoryProvider} MemoryProvider
 * @typedef {import('./vector-backend.mjs').VectorBackend} VectorBackend
 */

export class SqliteWriter {
  /**
   * @param {{
   *   sqliteProvider: MemoryProvider,
   *   vectorBackend?: VectorBackend|null,
   *   embedMode?: 'eager'|'lazy'
   * }} opts
   */
  constructor({ sqliteProvider, vectorBackend = null, embedMode }) {
    if (!sqliteProvider) throw new Error('SqliteWriter: sqliteProvider is required');

    this._sqlite = sqliteProvider;
    this._vectorBackend = vectorBackend || null;

    // Embed mode: eager (default) embeds on every write; lazy defers to search.
    this._embedMode = embedMode || (process.env.HERMIT_EMBED_MODE === 'lazy' ? 'lazy' : 'eager');

    /** @type {number} */
    this._vectorFailureCount = 0;
    /** @type {Error|null} */
    this._lastVectorError = null;
  }

  /**
   * Write entities + relations to SQLite (authoritative) + vec_entities (non-fatal).
   * All SQLite writes run under the provider's internal transaction for atomicity.
   *
   * @param {{ entities?: object[], relations?: object[] }} payload
   * @returns {Promise<void>}
   */
  async writeBoth({ entities = [], relations = [] } = {}) {
    // ── SQLite write (authoritative — throws propagate) ──
    for (const entity of entities) {
      await this._sqlite.writeEntity(entity);
    }
    for (const relation of relations) {
      await this._sqlite.writeRelation(relation);
    }

    // ── Vector upsert (non-fatal, eager mode only) ──
    if (this._vectorBackend && this._embedMode === 'eager' && entities.length > 0) {
      try {
        for (const entity of entities) {
          const obsText = (entity.observations || [])
            .map(o => (typeof o === 'string' ? o : (o.content || '')))
            .join('\n');
          const text = `${entity.name}\n${obsText}`.trim();
          const vec = await embed(text);
          if (vec) {
            await this._vectorBackend.upsert(entity.name, vec);
          }
        }
      } catch (err) {
        this._vectorFailureCount++;
        this._lastVectorError = err;
        process.stderr.write(`[hermit:sqlite-writer] Vector upsert failed (failure #${this._vectorFailureCount}): ${err.message}\n`);
      }
    }
  }

  /**
   * Convenience: write a single entity.
   * @param {object} entity
   * @returns {Promise<void>}
   */
  async writeEntity(entity) {
    return this.writeBoth({ entities: [entity], relations: [] });
  }

  /**
   * Convenience: write a single relation.
   * @param {object} relation
   * @returns {Promise<void>}
   */
  async writeRelation(relation) {
    return this.writeBoth({ entities: [], relations: [relation] });
  }

  /**
   * Telemetry — expose stats for monitoring and tests.
   * @returns {{ embedMode: string, vectorFailureCount: number, lastVectorError: string|null }}
   */
  getStats() {
    return {
      embedMode: this._embedMode,
      vectorFailureCount: this._vectorFailureCount,
      lastVectorError: this._lastVectorError ? this._lastVectorError.message : null,
    };
  }
}
