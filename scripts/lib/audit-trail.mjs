/**
 * Audit Trail — append-only observation history tracking.
 * Every edit/archive appends previous version to _history array.
 * Cap: 50 entries per observation to prevent JSONL bloat.
 */

const MAX_HISTORY = 50;

/**
 * Normalize observation to object format. Handles both v3 strings and v4 objects.
 * @param {string|object} obs
 * @returns {object} Normalized observation object
 */
export function normalizeObservation(obs) {
  if (typeof obs === 'string') {
    return { content: obs, _branch: null, _archived: false, _archivedAt: null, _history: [] };
  }
  return {
    content: obs.content || '',
    _branch: obs._branch || null,
    _archived: obs._archived || false,
    _archivedAt: obs._archivedAt || null,
    _history: obs._history || [],
  };
}

/**
 * Append current content to history before changing it.
 * @param {string|object} obs - Current observation
 * @param {string} reason - 'updated' | 'archived' | 'merged'
 * @returns {object} Observation with history entry appended
 */
export function appendHistory(obs, reason = 'updated') {
  const normalized = normalizeObservation(obs);
  const entry = {
    content: normalized.content,
    changedAt: new Date().toISOString(),
    reason,
  };
  const history = [...normalized._history, entry].slice(-MAX_HISTORY);
  return { ...normalized, _history: history };
}

/**
 * Archive an observation with history tracking.
 * @param {string|object} obs
 * @returns {object} Archived observation with history
 */
export function archiveObservation(obs) {
  const withHistory = appendHistory(obs, 'archived');
  return { ...withHistory, _archived: true, _archivedAt: new Date().toISOString() };
}

/**
 * Archive every relation touching one of the given entity names.
 * Archiving an entity without cascading leaves relations pointing at a node
 * that health checks no longer see — a dangling graph.
 * @param {Array} relations - mutated in place
 * @param {Set<string>|Array<string>} names - archived entity names
 * @returns {number} count of relations archived
 */
export function archiveRelationsFor(relations, names) {
  const targets = new Set(names);
  let archived = 0;
  const at = new Date().toISOString();
  for (const rel of relations) {
    if (rel._archived) continue;
    if (!targets.has(rel.from) && !targets.has(rel.to)) continue;
    rel._archived = true;
    rel._archivedAt = at;
    rel._history = [...(rel._history || []), { action: 'archived_with_entity', at }];
    archived++;
  }
  return archived;
}

/**
 * Repoint relations from a merged-away entity onto the entity it merged into,
 * dropping self-loops and duplicates. Used by dedup, where the knowledge is
 * kept (unlike archival) so the edges should follow it.
 * @param {Array} relations - mutated in place
 * @param {string} fromName - the merged-away (secondary) entity
 * @param {string} toName - the surviving (primary) entity
 * @returns {number} count of relations repointed
 */
export function repointRelations(relations, fromName, toName) {
  const seen = new Set(relations.map(r => `${r.from}|||${r.to}|||${r.relationType}`));
  let repointed = 0;
  for (const rel of relations) {
    if (rel._archived) continue;
    if (rel.from !== fromName && rel.to !== fromName) continue;
    const next = {
      from: rel.from === fromName ? toName : rel.from,
      to: rel.to === fromName ? toName : rel.to,
    };
    // Self-loop or an edge that already exists → retire this one instead.
    const key = `${next.from}|||${next.to}|||${rel.relationType}`;
    if (next.from === next.to || seen.has(key)) {
      rel._archived = true;
      rel._archivedAt = new Date().toISOString();
      continue;
    }
    rel.from = next.from;
    rel.to = next.to;
    seen.add(key);
    repointed++;
  }
  return repointed;
}

/**
 * Collect all history entries from an entity's observations.
 * @param {object} entity
 * @returns {Array<{content, changedAt, reason, observationIndex}>} Sorted newest-first
 */
export function getEntityHistory(entity) {
  const allHistory = [];
  const observations = entity.observations || [];
  for (let i = 0; i < observations.length; i++) {
    const normalized = normalizeObservation(observations[i]);
    for (const h of normalized._history) {
      allHistory.push({ ...h, observationIndex: i });
    }
  }
  return allHistory.sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
}
