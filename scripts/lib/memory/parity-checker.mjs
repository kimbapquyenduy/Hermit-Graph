/**
 * parity-checker.mjs — Pure semantic-equivalence checker between JSONL and SQLite stores.
 * Compares entity sets, relation sets, and per-entity observation content.
 * Does NOT log full observation text — only counts and entity names.
 *
 * @module parity-checker
 */

/**
 * Normalize observation text for comparison:
 *   - trim whitespace
 *   - case-insensitive (lowercased)
 * @param {string} raw
 * @returns {string}
 */
function normalizeObs(raw) {
  return (typeof raw === 'string' ? raw : (raw?.content || '')).trim().toLowerCase();
}

/**
 * Get canonical observation fingerprint array for an entity (sorted, normalized).
 * @param {object} entity
 * @returns {string[]}
 */
function obsFingerprints(entity) {
  return (entity.observations || [])
    .map(normalizeObs)
    .filter(s => s.length > 0)
    .sort();
}

/**
 * Canonical key for a relation (order-stable).
 * @param {object} rel
 * @returns {string}
 */
function relKey(rel) {
  return `${rel.from}|${rel.to}|${rel.relationType}`;
}

/**
 * Compare two sorted string arrays for equality.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Check semantic parity between JSONL and SQLite data.
 *
 * Rules:
 *   - Entity parity: same set of entity names (case-sensitive)
 *   - Relation parity: same set of (from, to, relationType) tuples
 *   - Observation parity: per entity, sorted+normalized text arrays must match
 *
 * Privacy: report lists entity names + counts only, never full observation text.
 *
 * @param {{ entities: Map<string, object>, relations: object[] }} jsonlData
 * @param {{ entities: Map<string, object>, relations: object[] }} sqliteData
 * @returns {{ parity: boolean, report: object }}
 */
export function checkParity(jsonlData, sqliteData) {
  const { entities: jEntities, relations: jRelations } = jsonlData;
  const { entities: sEntities, relations: sRelations } = sqliteData;

  // ── Entity set diff ─────────────────────────────────────────────────────
  const jNames = new Set(jEntities.keys());
  const sNames = new Set(sEntities.keys());

  const missingInDb = [...jNames].filter(n => !sNames.has(n));
  const missingInJsonl = [...sNames].filter(n => !jNames.has(n));

  // ── Observation drift (entities present in both) ─────────────────────────
  const driftedObservations = [];
  for (const name of jNames) {
    if (!sNames.has(name)) continue;
    const jObs = obsFingerprints(jEntities.get(name));
    const sObs = obsFingerprints(sEntities.get(name));
    if (!arraysEqual(jObs, sObs)) {
      driftedObservations.push({
        entity: name,
        jsonlCount: jObs.length,
        sqliteCount: sObs.length,
      });
    }
  }

  // ── Relation set diff ────────────────────────────────────────────────────
  const jRelSet = new Set(jRelations.map(relKey));
  const sRelSet = new Set(sRelations.map(relKey));

  const missingRelationsInDb = [...jRelSet].filter(k => !sRelSet.has(k));
  const missingRelationsInJsonl = [...sRelSet].filter(k => !jRelSet.has(k));

  // ── Summary ──────────────────────────────────────────────────────────────
  const parity =
    missingInDb.length === 0 &&
    missingInJsonl.length === 0 &&
    driftedObservations.length === 0 &&
    missingRelationsInDb.length === 0 &&
    missingRelationsInJsonl.length === 0;

  const report = {
    parity,
    totalEntitiesJsonl: jNames.size,
    totalEntitiesSqlite: sNames.size,
    totalRelationsJsonl: jRelations.length,
    totalRelationsSqlite: sRelations.length,
    missingInDb,
    missingInJsonl,
    missingRelationsInDb,
    missingRelationsInJsonl,
    driftedObservations,
  };

  return { parity, report };
}
