/**
 * sqlite-write-helpers.mjs — Prepared statement builders + transaction helpers
 * for SqliteProvider. Kept separate to hold sqlite-backend.mjs ≤200 LOC.
 */

import { parseObservation } from '../parse-observation.mjs';

/**
 * Extract category prefix from observation text (e.g. "RULE:", "WHAT:").
 * @param {string} text - Stripped observation text (after prefix removed)
 * @returns {string|null}
 */
function extractCategory(text) {
  const m = text.match(/^([A-Z]{2,10}):/);
  return m ? m[1] : null;
}

/**
 * Prepare all hot-path write statements on the given db instance.
 * Returns an object of named prepared statements.
 * @param {import('better-sqlite3').Database} db
 * @returns {object}
 */
export function prepareStatements(db) {
  return {
    upsertEntity: db.prepare(`
      INSERT INTO entities(name, entity_type, created_at, updated_at)
      VALUES(@name, @entityType, @now, @now)
      ON CONFLICT(name) DO UPDATE SET
        entity_type = excluded.entity_type,
        updated_at  = excluded.updated_at
    `),

    deleteObservations: db.prepare(
      `DELETE FROM observations WHERE entity_name = ?`
    ),

    insertObservation: db.prepare(`
      INSERT INTO observations(entity_name, raw_text, confidence, obs_date, category, ord)
      VALUES(@entityName, @rawText, @confidence, @obsDate, @category, @ord)
    `),

    upsertRelation: db.prepare(`
      INSERT INTO relations(from_name, to_name, relation_type)
      VALUES(@fromName, @toName, @relationType)
      ON CONFLICT(from_name, to_name, relation_type) DO NOTHING
    `),

    selectEntity: db.prepare(
      `SELECT name, entity_type FROM entities WHERE lower(name) = lower(?)`
    ),

    selectObservations: db.prepare(
      `SELECT raw_text, ord FROM observations WHERE entity_name = ? ORDER BY ord`
    ),

    deleteEntity: db.prepare(
      `DELETE FROM entities WHERE lower(name) = lower(?)`
    ),

    deleteRelationsFor: db.prepare(
      `DELETE FROM relations WHERE lower(from_name) = lower(?) OR lower(to_name) = lower(?)`
    ),

    selectEntityExact: db.prepare(
      `SELECT name FROM entities WHERE lower(name) = lower(?)`
    ),

    upsertMeta: db.prepare(`
      INSERT INTO meta(key, value) VALUES(?, ?)
      ON CONFLICT(key) DO NOTHING
    `),
  };
}

/**
 * Write a single entity (upsert) + replace its observations inside an existing transaction.
 * @param {object} stmts - Prepared statements from prepareStatements()
 * @param {object} entity - { name, entityType, observations: string[] }
 */
export function writeEntityInTx(stmts, entity) {
  const now = new Date().toISOString();
  stmts.upsertEntity.run({ name: entity.name, entityType: entity.entityType || '', now });

  stmts.deleteObservations.run(entity.name);

  const observations = entity.observations || [];
  for (let ord = 0; ord < observations.length; ord++) {
    const raw = observations[ord];
    const rawText = typeof raw === 'string' ? raw : (raw?.content || '');
    const parsed = parseObservation(rawText);
    stmts.insertObservation.run({
      entityName: entity.name,
      rawText,
      confidence: parsed.confidence,
      obsDate: parsed.date,
      category: extractCategory(parsed.text),
      ord,
    });
  }
}

/**
 * Read back a single entity + its observations from DB.
 * @param {object} stmts
 * @param {string} name
 * @returns {object|null}
 */
export function readEntityFromDb(stmts, name) {
  const row = stmts.selectEntity.get(name);
  if (!row) return null;
  const obsRows = stmts.selectObservations.all(row.name);
  return {
    type: 'entity',
    name: row.name,
    entityType: row.entity_type,
    observations: obsRows.map(r => r.raw_text),
  };
}
