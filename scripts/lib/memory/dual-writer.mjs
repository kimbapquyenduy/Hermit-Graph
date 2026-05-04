/**
 * dual-writer.mjs — Fan writes to JSONL (authoritative) + SQLite (mirror) under one lock.
 *
 * Usage:
 *   const writer = new DualWriter({ jsonlProvider, sqliteProvider, enabled: true });
 *   await writer.writeBoth({ entities: [...], relations: [...] });
 *
 * Failure contract:
 *   - JSONL throws → propagate (JSONL is authoritative)
 *   - SQLite throws → log warning, increment failure counter, swallow (mirror is non-fatal)
 *   - HERMIT_DUAL_WRITE=0 → SQLite writes skipped entirely
 */

/**
 * @typedef {import('./provider-interface.mjs').MemoryProvider} MemoryProvider
 */

export class DualWriter {
  /**
   * @param {{ jsonlProvider: MemoryProvider, sqliteProvider: MemoryProvider, enabled?: boolean }} opts
   *   enabled defaults to true unless HERMIT_DUAL_WRITE env var is literally "0"
   */
  constructor({ jsonlProvider, sqliteProvider, enabled }) {
    if (!jsonlProvider) throw new Error('DualWriter: jsonlProvider is required');
    if (!sqliteProvider) throw new Error('DualWriter: sqliteProvider is required');

    this._jsonl = jsonlProvider;
    this._sqlite = sqliteProvider;

    // Resolve enabled: explicit param wins; else check env; default true
    if (typeof enabled === 'boolean') {
      this._enabled = enabled;
    } else {
      this._enabled = process.env.HERMIT_DUAL_WRITE !== '0';
    }

    /** @type {Error|null} */
    this._lastSqliteError = null;
    /** @type {number} */
    this._sqliteFailureCount = 0;
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
      sqliteFailureCount: this._sqliteFailureCount,
      lastSqliteError: this._lastSqliteError ? this._lastSqliteError.message : null,
    };
  }
}
