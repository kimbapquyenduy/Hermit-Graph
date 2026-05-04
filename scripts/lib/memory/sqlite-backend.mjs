/**
 * sqlite-backend.mjs — SqliteProvider implements MemoryProvider over better-sqlite3.
 * Write path fully functional (Phase 01a). Read path stubbed for Phase 01c.
 *
 * Usage:
 *   const provider = new SqliteProvider({ dbPath: '/path/to/brain.db' });
 *   await provider.withLock(() => provider.writeEntity(entity));
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MemoryProvider } from './provider-interface.mjs';
import {
  prepareStatements,
  writeEntityInTx,
  readEntityFromDb,
} from './sqlite-write-helpers.mjs';

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

    // Boot: apply schema (idempotent CREATE IF NOT EXISTS)
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    this._db.exec(schema);

    // Seed schema_version row if not present
    this._db.prepare(
      `INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO NOTHING`
    ).run(String(SCHEMA_VERSION));

    // Prepare hot-path statements
    this._stmts = prepareStatements(this._db);
  }

  /**
   * Feature flags. FTS5 present but read queries pending Phase 01c.
   * @returns {{ keyword: string, vector: boolean, fts5: boolean, transactional: boolean }}
   */
  capabilities() {
    return { keyword: 'fts5-pending', vector: false, fts5: true, transactional: true };
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
      // ON DELETE CASCADE handles observations; manually clean relations
      this._stmts.deleteRelationsFor.run(existing.name, existing.name);
      this._stmts.deleteEntity.run(name);
    });
    tx();
    return true;
  }

  /**
   * Look up a single entity by exact name (case-insensitive). Lock-free.
   * @param {string} name
   * @returns {Promise<object|null>}
   */
  async getEntity(name) {
    if (!name) return null;
    return readEntityFromDb(this._stmts, name);
  }

  // ── Read stubs (Phase 01c) ────────────────────────────────────────────────

  /** @returns {Promise<{ entities: Map<string, object>, relations: object[] }>} */
  async readAll() {
    // TODO: phase 01c — full read path
    return { entities: new Map(), relations: [] };
  }

  /** @returns {Promise<Array<{ name: string, entityType: string, score: number }>>} */
  async searchKeyword(_query, _opts) {
    // TODO: phase 01c — FTS5 BM25 search
    return [];
  }

  /** @returns {Promise<Array>} */
  async searchVector(_query, _opts) {
    // TODO: phase 01c — vector search (requires embedding column)
    return [];
  }

  // ── Lock ──────────────────────────────────────────────────────────────────

  /**
   * For sync better-sqlite3, "lock" is a no-op wrapper — transactions handle atomicity.
   * Wraps fn in a promise for interface compatibility.
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
