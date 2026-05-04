/**
 * sqlite-vec-adapter.mjs — SqliteVecBackend: write-side vector storage via sqlite-vec.
 *
 * Stores 384-dim embeddings in a vec0 virtual table inside the same brain.db
 * used by SqliteProvider. Requires sqlite-vec extension already loaded on the
 * provided better-sqlite3 instance.
 *
 * Usage:
 *   import { SqliteVecBackend } from './sqlite-vec-adapter.mjs';
 *   const backend = new SqliteVecBackend({ db: sqliteProvider.getDb() });
 *   await backend.upsert('TECH:MyEntity', float32ArrayVec);
 */

import { VectorBackend } from './vector-backend.mjs';

const EMBEDDING_DIM = 384;
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/**
 * Serialize Float32Array to the BLOB format sqlite-vec expects.
 * Raw little-endian IEEE-754 bytes — same memory layout as the underlying buffer.
 * @param {Float32Array} vec
 * @returns {Buffer}
 */
function vecToBlob(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export class SqliteVecBackend extends VectorBackend {
  /**
   * @param {{ db: import('better-sqlite3').Database }} opts
   *   db — open better-sqlite3 instance (same connection as SqliteProvider).
   */
  constructor({ db }) {
    super();
    if (!db) throw new Error('SqliteVecBackend: db is required');
    this._db = db;

    // Verify extension is loaded — throws if vec_version() is not available.
    try {
      this._db.prepare('SELECT vec_version()').get();
    } catch (err) {
      throw new Error(`SqliteVecBackend: sqlite-vec extension not loaded — ${err.message}`);
    }

    // Create vec0 virtual table (idempotent).
    this._db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_entities
       USING vec0(name TEXT PRIMARY KEY, embedding FLOAT[${EMBEDDING_DIM}])`
    );

    // Record embedding metadata in meta table for future migration safety.
    const setMeta = this._db.prepare(
      `INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    );
    const seedMeta = this._db.transaction(() => {
      setMeta.run('embedding_dim', String(EMBEDDING_DIM));
      setMeta.run('embedding_model', MODEL_ID);
    });
    seedMeta();

    // Prepare hot-path statements.
    // Note: vec0 virtual tables do NOT support INSERT OR REPLACE — use DELETE + INSERT.
    this._stmtInsert = this._db.prepare(
      `INSERT INTO vec_entities(name, embedding) VALUES (?, ?)`
    );
    this._stmtDelete = this._db.prepare(
      `DELETE FROM vec_entities WHERE name = ?`
    );
    this._stmtCount = this._db.prepare(
      `SELECT COUNT(*) AS n FROM vec_entities`
    );
  }

  /** @returns {{ vector: string, dim: number, searchAvailable: boolean }} */
  capabilities() {
    return { vector: 'sqlite-vec', dim: EMBEDDING_DIM, searchAvailable: false };
  }

  /**
   * Upsert an entity's embedding. Creates or replaces by name (vec0 PRIMARY KEY).
   * @param {string} name
   * @param {Float32Array} vec - Must be exactly 384-dim with finite values.
   * @returns {Promise<void>}
   */
  async upsert(name, vec) {
    if (!name) throw new Error('SqliteVecBackend.upsert: name is required');
    if (!(vec instanceof Float32Array)) {
      throw new Error(`SqliteVecBackend.upsert: vec must be Float32Array, got ${typeof vec}`);
    }
    if (vec.length !== EMBEDDING_DIM) {
      throw new Error(`SqliteVecBackend.upsert: expected ${EMBEDDING_DIM}-dim vector, got ${vec.length}`);
    }
    for (let i = 0; i < vec.length; i++) {
      if (!isFinite(vec[i])) {
        throw new Error(`SqliteVecBackend.upsert: vector contains non-finite value at index ${i}`);
      }
    }
    const blob = vecToBlob(vec);
    // vec0 does not support INSERT OR REPLACE; emulate upsert via DELETE + INSERT.
    const run = this._db.transaction(() => {
      this._stmtDelete.run(name);
      this._stmtInsert.run(name, blob);
    });
    run();
  }

  /**
   * Upsert multiple (name, vec) pairs in a single transaction for batch perf.
   * @param {Array<[string, Float32Array]>} pairs
   * @returns {Promise<void>}
   */
  async upsertBatch(pairs) {
    if (!pairs || pairs.length === 0) return;
    // vec0 does not support INSERT OR REPLACE; emulate upsert via DELETE + INSERT per row.
    const run = this._db.transaction(() => {
      for (const [name, vec] of pairs) {
        if (!(vec instanceof Float32Array) || vec.length !== EMBEDDING_DIM) {
          throw new Error(`upsertBatch: invalid vector for "${name}"`);
        }
        this._stmtDelete.run(name);
        this._stmtInsert.run(name, vecToBlob(vec));
      }
    });
    run();
  }

  /**
   * Delete an entity's embedding. No-op if not found.
   * @param {string} name
   * @returns {Promise<void>}
   */
  async delete(name) {
    if (!name) throw new Error('SqliteVecBackend.delete: name is required');
    const run = this._db.transaction(() => this._stmtDelete.run(name));
    run();
  }

  /**
   * Count total vectors stored in vec_entities.
   * @returns {Promise<number>}
   */
  async count() {
    const row = this._stmtCount.get();
    return row.n;
  }

  /**
   * kNN search — not implemented in Phase 03b (write-only).
   * @throws {Error} Always — implemented in Phase 03c.
   */
  async search(_queryVec, _topK) {
    throw new Error('SqliteVecBackend.search() not yet implemented — Phase 03c');
  }
}
