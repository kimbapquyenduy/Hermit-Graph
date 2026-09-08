/**
 * dual-writer.mjs — Fan writes to JSONL (authoritative) + SQLite (mirror) under one lock.
 * Phase 03b: optionally upserts embeddings to vector backend after SQLite write.
 *
 * Usage:
 *   const writer = new DualWriter({ jsonlProvider, sqliteProvider, enabled: true });
 *   await writer.writeBoth({ entities: [...], relations: [...] });
 *
 * Failure contract:
 *   - JSONL throws → propagate (JSONL is authoritative)
 *   - SQLite throws → log warning, increment failure counter, swallow (mirror is non-fatal)
 *   - Vector upsert throws → log warning, swallow (vector is non-fatal)
 *   - HERMIT_DUAL_WRITE=0 → SQLite + vector writes skipped entirely
 *   - HERMIT_EMBED_MODE=eager (default) → embed on every write
 *   - HERMIT_EMBED_MODE=lazy → skip embed here; deferred to first search miss (Phase 03c)
 */

import { embed } from '../embedding-service.mjs';
import { entityId } from './entity-identity.mjs';

/**
 * @typedef {import('./provider-interface.mjs').MemoryProvider} MemoryProvider
 * @typedef {import('./vector-backend.mjs').VectorBackend} VectorBackend
 */

export class DualWriter {
  /**
   * @param {{
   *   jsonlProvider: MemoryProvider,
   *   sqliteProvider: MemoryProvider,
   *   enabled?: boolean,
   *   vectorBackend?: VectorBackend|null
   * }} opts
   *   enabled defaults to true unless HERMIT_DUAL_WRITE env var is literally "0"
   *   vectorBackend: optional; null disables vector upsert
   */
  constructor({ jsonlProvider, sqliteProvider, enabled, vectorBackend = null }) {
    if (!jsonlProvider) throw new Error('DualWriter: jsonlProvider is required');
    if (!sqliteProvider) throw new Error('DualWriter: sqliteProvider is required');

    this._jsonl = jsonlProvider;
    this._sqlite = sqliteProvider;
    this._vectorBackend = vectorBackend || null;

    // Resolve enabled: explicit param wins; else check env; default true
    if (typeof enabled === 'boolean') {
      this._enabled = enabled;
    } else {
      this._enabled = process.env.HERMIT_DUAL_WRITE !== '0';
    }

    // Embed mode: eager (default) embeds on every write; lazy defers to search (Phase 03c).
    this._embedMode = process.env.HERMIT_EMBED_MODE === 'lazy' ? 'lazy' : 'eager';

    /** @type {Error|null} */
    this._lastSqliteError = null;
    /** @type {number} */
    this._sqliteFailureCount = 0;
    /** @type {number} */
    this._vectorFailureCount = 0;
  }

  /**
   * Write entities + relations to both backends under the JSONL lock.
   * JSONL write is authoritative; SQLite failure is non-fatal.
   *
   * @param {{ entities?: object[], relations?: object[] }} payload
   * @returns {Promise<void>}
   */
  async writeBoth({ entities = [], relations = [] } = {}) {
    await this._jsonl.withLock(async () => {
      // ── JSONL write (authoritative — throws propagate) ──
      for (const entity of entities) {
        await this._jsonl.writeEntity(entity);
      }
      for (const relation of relations) {
        await this._jsonl.writeRelation(relation);
      }

      // ── SQLite mirror (non-fatal) ──
      if (!this._enabled) return;

      try {
        for (const entity of entities) {
          await this._sqlite.writeEntity(entity);
        }
        for (const relation of relations) {
          await this._sqlite.writeRelation(relation);
        }
      } catch (err) {
        this._lastSqliteError = err;
        this._sqliteFailureCount++;
        // Log to stderr; do NOT rethrow — JSONL already committed
        process.stderr.write(`[hermit:dual-writer] SQLite mirror failed (failure #${this._sqliteFailureCount}): ${err.message}\n`);
      }

      // ── Vector upsert (non-fatal, eager mode only) ──
      if (this._vectorBackend && this._embedMode === 'eager' && entities.length > 0) {
        try {
          for (const entity of entities) {
            // Build embed text: name + all observation strings joined
            const obsText = (entity.observations || [])
              .map(o => (typeof o === 'string' ? o : (o.content || '')))
              .join('\n');
            const text = `${entity.name}\n${obsText}`.trim();
            const vec = await embed(text);
            if (vec) {
              await this._vectorBackend.upsert(entityId(entity), vec);
            }
          }
        } catch (err) {
          this._vectorFailureCount++;
          process.stderr.write(`[hermit:dual-writer] Vector upsert failed (failure #${this._vectorFailureCount}): ${err.message}\n`);
        }
      }
    });
  }

  /**
   * Convenience: write a single entity through writeBoth.
   * @param {object} entity
   * @returns {Promise<void>}
   */
  async writeEntity(entity) {
    return this.writeBoth({ entities: [entity], relations: [] });
  }

  /**
   * Convenience: write a single relation through writeBoth.
   * @param {object} relation
   * @returns {Promise<void>}
   */
  async writeRelation(relation) {
    return this.writeBoth({ entities: [], relations: [relation] });
  }

  /**
   * Telemetry — expose failure stats for soak tests and monitoring.
   * @returns {{ enabled: boolean, sqliteFailureCount: number, lastSqliteError: string|null }}
   */
  getStats() {
    return {
      enabled: this._enabled,
      embedMode: this._embedMode,
      sqliteFailureCount: this._sqliteFailureCount,
      lastSqliteError: this._lastSqliteError ? this._lastSqliteError.message : null,
      vectorFailureCount: this._vectorFailureCount,
    };
  }
}
