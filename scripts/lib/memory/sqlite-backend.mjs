/**
 * sqlite-backend.mjs — SqliteProvider implements MemoryProvider over better-sqlite3.
 * Write path: Phase 01a. Read path + FTS5 BM25 search: Phase 01c.
 *
 * Usage:
 *   const provider = new SqliteProvider({ dbPath: '/path/to/brain.db' });
 *   await provider.withLock(() => provider.writeEntity(entity));
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as sqliteVec from 'sqlite-vec';
import { MemoryProvider } from './provider-interface.mjs';
import {
  prepareStatements,
  writeEntityInTx,
  readEntityFromDb,
} from './sqlite-write-helpers.mjs';
import {
  prepareReadStatements,
  readAllFromDb,
  searchKeywordFts,
} from './sqlite-read-helpers.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, 'sqlite-schema.sql');
const SCHEMA_VERSION = 1;

/** Default db path relative to repo root (two levels up from scripts/lib/memory/) */
const DEFAULT_DB_PATH = join(__dirname, '..', '..', '..', 'data', 'brain.db');

export class SqliteProvider extends MemoryProvider {
  /**
   * @param {{ dbPath?: string }} [options]
   */
  constructor({ dbPath } = {}) {
    super();
    const Database = require('better-sqlite3');
    this._dbPath = dbPath || DEFAULT_DB_PATH;

    // Open (creates file if absent). WAL mode for concurrency headroom.
    this._db = Database(this._dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');

    // Phase 03b: load sqlite-vec extension for vector storage. Non-fatal if unavailable.
    this.vectorEnabled = false;
    try {
      sqliteVec.load(this._db);
      this.vectorEnabled = true;
    } catch (err) {
      process.stderr.write(`[hermit:sqlite] sqlite-vec extension failed to load: ${err.message}\n`);
    }

    // Boot: apply schema (idempotent CREATE IF NOT EXISTS)
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    this._db.exec(schema);

    // Phase 01c migration: if entities_fts is old contentless table, recreate as content table.
    // Detection: contentless tables have no stored data — SELECT name returns '' for all rows.
    this._migrateFtsIfNeeded();

    // Seed schema_version row if not present
    this._db.prepare(
      `INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO NOTHING`
    ).run(String(SCHEMA_VERSION));

    // Prepare hot-path statements
    this._stmts = prepareStatements(this._db);
    this._readStmts = prepareReadStatements(this._db);
  }

  /**
   * Detect and migrate old contentless entities_fts to content-storing variant.
   * Contentless FTS5 tables return empty strings for column values on SELECT.
   * If the table exists but has rows with empty names, it's the old schema — drop and recreate.
   * @private
   */
  _migrateFtsIfNeeded() {
    // Check if FTS table exists and is the contentless variant by probing a SELECT
    try {
      const probe = this._db.prepare(
        `SELECT name FROM entities_fts LIMIT 1`
      ).get();
      // If we have rows and the name is empty string, it's contentless
      if (probe !== undefined && probe.name === '') {
        this._db.exec(`DROP TABLE IF EXISTS entities_fts`);
        this._db.exec(
          `CREATE VIRTUAL TABLE entities_fts USING fts5(name, obs_text)`
        );
      }
    } catch (_e) {
      // Table may not exist yet — schema creation handles it
    }
  }

  /**
   * Feature flags. BM25 search available via FTS5.
   * vector flag reflects whether sqlite-vec loaded successfully.
   * @returns {{ keyword: string, vector: boolean, fts5: boolean, transactional: boolean }}
   */
  capabilities() {
    return { keyword: 'bm25', vector: this.vectorEnabled, fts5: true, transactional: true };
  }

  /**
   * Expose the raw better-sqlite3 Database instance for the vec backend to share.
   * Only SqliteVecBackend should call this — keep internal coupling minimal.
   * @returns {import('better-sqlite3').Database}
   */
  getDb() {
    return this._db;
  }

  // ── Write methods ─────────────────────────────────────────────────────────

  /**
   * Upsert a single entity + replace its observations. Must be inside withLock().
   * @param {object} entity - { name, entityType, observations: string[] }
   * @returns {Promise<void>}
   */
  async writeEntity(entity) {
    if (!entity || !entity.name) throw new Error('writeEntity: entity.name is required');
    const tx = this._db.transaction(() => writeEntityInTx(this._stmts, entity));
    tx();
  }

  /**
   * Upsert a relation (deduplicates via UNIQUE constraint). Must be inside withLock().
   * @param {object} relation - { from, to, relationType }
   * @returns {Promise<void>}
   */
  async writeRelation(relation) {
    if (!relation?.from || !relation?.to || !relation?.relationType) {
      throw new Error('writeRelation: from, to, relationType are required');
    }
    this._stmts.upsertRelation.run({
      fromName: relation.from,
      toName: relation.to,
      relationType: relation.relationType,
    });
  }

  /**
   * Hard-delete entity + cascade observations + orphaned relations. Must be inside withLock().
   * @param {string} name
   * @returns {Promise<boolean>} true if entity existed and was deleted
   */
  async deleteEntity(name) {
    if (!name) throw new Error('deleteEntity: name is required');
    const existing = this._stmts.selectEntityExact.get(name);
    if (!existing) return false;
    const tx = this._db.transaction(() => {
      // ON DELETE CASCADE handles observations; manually clean relations + FTS5
      this._stmts.deleteRelationsFor.run(existing.name, existing.name);
      this._stmts.deleteFts.run(existing.name);
      this._stmts.deleteEntity.run(name);
    });
    tx();
    return true;
  }

  // ── Read methods (Phase 01c) ──────────────────────────────────────────────

  /**
   * Look up a single entity by exact name (case-insensitive). Lock-free.
   * @param {string} name
   * @returns {Promise<object|null>}
   */
  async getEntity(name) {
    if (!name) return null;
    return readEntityFromDb(this._stmts, name);
  }

  /**
   * Read full graph — all entities + relations. Matches JsonlProvider shape exactly.
   * @returns {Promise<{ entities: Map<string, object>, relations: object[] }>}
   */
  async readAll() {
    return readAllFromDb(this._readStmts);
  }

  /**
   * BM25 keyword search via FTS5. Returns higher-is-better score.
   * @param {string} query
   * @param {{ topK?: number }} [opts]
   * @returns {Promise<Array<{ name: string, entityType: string, score: number, observationCount: number }>>}
   */
  async searchKeyword(query, opts = {}) {
    if (!query) return [];
    return searchKeywordFts(this._readStmts, query, opts);
  }

  /** Vector search — not implemented in SQLite backend (no embedding column). */
  async searchVector(_query, _opts) {
    return [];
  }

  // ── Lock ──────────────────────────────────────────────────────────────────

  /**
   * For sync better-sqlite3, "lock" is a no-op wrapper — transactions handle atomicity.
   * @param {Function} fn
   * @returns {Promise<*>}
   */
  async withLock(fn) {
    return fn();
  }

  /**
   * Close the database connection. Call when done (e.g., in tests).
   */
  close() {
    this._db.close();
  }
}
