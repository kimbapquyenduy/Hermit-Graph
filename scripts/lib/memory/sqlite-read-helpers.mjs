/**
 * sqlite-read-helpers.mjs — Read-path helpers for SqliteProvider.
 * Kept separate to hold sqlite-backend.mjs ≤200 LOC.
 *
 * Implements: readAll, readRelations, searchKeyword (FTS5 BM25).
 */

/** Max topK allowed — hard cap to bound result set size. */
const TOP_K_MAX = 100;

/**
 * Sanitize a raw query string for FTS5 MATCH with prefix matching.
 * Each whitespace-delimited token becomes a prefix query ("token"*) so that
 * "Gateway" matches "Gateway71", "Auth" matches "Auth:Foo" tokenized segments, etc.
 * Special chars (`:`, `-`, `(`, `)`, `^`, `+`, `"`) are stripped before quoting.
 *
 * @param {string} query
 * @returns {string} FTS5-safe MATCH expression, or empty string if no tokens
 */
export function sanitizeFtsQuery(query) {
  // Split on whitespace; strip FTS5 operator chars (keep alphanumeric + colon for partial)
  const tokens = query
    .split(/\s+/)
    .map(t => t.replace(/["^()+\-]/g, '').trim())
    .filter(t => t.length > 0);
  if (!tokens.length) return '';
  // "token"* = prefix match — FTS5 finds any token starting with this string
  return tokens.map(t => `"${t}"*`).join(' ');
}

/**
 * Prepare FTS5 read statements. Called once at SqliteProvider boot.
 * @param {import('better-sqlite3').Database} db
 * @returns {object}
 */
export function prepareReadStatements(db) {
  return {
    /** Full entity scan — no COLLATE needed, PK is exact-case */
    selectAllEntities: db.prepare(
      `SELECT name, entity_type FROM entities ORDER BY name`
    ),
    /** All observations ordered by entity + position */
    selectAllObservations: db.prepare(
      `SELECT entity_name, raw_text, ord FROM observations ORDER BY entity_name, ord`
    ),
    /** All relations */
    selectAllRelations: db.prepare(
      `SELECT from_name, to_name, relation_type FROM relations`
    ),
    /**
     * FTS5 BM25 search — returns name + rank only (no JOIN).
     * BM25 lower = better (returns negative values).
     * Caller resolves entity_type + obs_count in a second lightweight query.
     */
    searchFtsRaw: db.prepare(
      `SELECT name, bm25(entities_fts) AS rank
       FROM entities_fts
       WHERE entities_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    ),
    /** Batch-fetch entity_type + obs count for a set of names (called per result row). */
    selectEntityMeta: db.prepare(
      `SELECT e.name, e.entity_type,
              (SELECT COUNT(*) FROM observations WHERE entity_name = e.name) AS obs_count
       FROM entities e
       WHERE e.name = ?`
    ),
  };
}

/**
 * Assemble full graph from three flat DB queries.
 * Returns shape matching JsonlProvider.readAll().
 *
 * @param {object} readStmts - from prepareReadStatements()
 * @returns {{ entities: Map<string, object>, relations: object[] }}
 */
export function readAllFromDb(readStmts) {
  const entityRows = readStmts.selectAllEntities.all();
  const obsRows = readStmts.selectAllObservations.all();
  const relRows = readStmts.selectAllRelations.all();

  // Group observations by entity_name
  /** @type {Map<string, string[]>} */
  const obsMap = new Map();
  for (const r of obsRows) {
    if (!obsMap.has(r.entity_name)) obsMap.set(r.entity_name, []);
    obsMap.get(r.entity_name).push(r.raw_text);
  }

  // Build entity Map
  const entities = new Map();
  for (const r of entityRows) {
    entities.set(r.name, {
      type: 'entity',
      name: r.name,
      entityType: r.entity_type,
      observations: obsMap.get(r.name) || [],
    });
  }

  // Build relations array (matches JsonlProvider's {type, from, to, relationType})
  const relations = relRows.map(r => ({
    type: 'relation',
    from: r.from_name,
    to: r.to_name,
    relationType: r.relation_type,
  }));

  return { entities, relations };
}

/**
 * Execute FTS5 BM25 keyword search.
 * Returns array of { name, entityType, score, observationCount } sorted descending by score.
 *
 * Two-step approach:
 *   1. FTS5 MATCH → name + bm25 rank (fast virtual table scan)
 *   2. Per-row entity meta fetch (by PK — O(1) each)
 *
 * BM25 returns lower-is-better (negative) values.
 * We negate rank so the caller sees higher-is-better positive scores.
 *
 * @param {object} readStmts - from prepareReadStatements()
 * @param {string} query
 * @param {{ topK?: number }} [opts]
 * @returns {Array<{ name: string, entityType: string, score: number, observationCount: number }>}
 */
export function searchKeywordFts(readStmts, query, opts = {}) {
  const topK = Math.min(opts.topK ?? 10, TOP_K_MAX);
  const safe = sanitizeFtsQuery(query);
  if (!safe) return [];

  const ftsRows = readStmts.searchFtsRaw.all(safe, topK);
  const results = [];
  for (const row of ftsRows) {
    const meta = readStmts.selectEntityMeta.get(row.name);
    results.push({
      id: row.name,
      name: row.name,
      entityType: meta?.entity_type ?? '',
      // Negate: BM25 returns negative values (lower = better), caller wants higher = better
      score: -row.rank,
      observationCount: meta?.obs_count ?? 0,
    });
  }
  return results;
}
