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
