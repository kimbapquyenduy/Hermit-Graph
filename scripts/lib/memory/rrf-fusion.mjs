/**
 * rrf-fusion.mjs — Reciprocal Rank Fusion (RRF) for hybrid retrieval.
 *
 * Pure function: no I/O, no side effects, deterministic.
 * Formula: score(d) = Σ 1 / (k + rank_i(d))
 *   where rank_i is 0-based position in ranking list i.
 *
 * @module rrf-fusion
 */

/**
 * @typedef {Object} RankedItem
 * @property {string} name - Unique entity name
 * @property {string} [source] - Which ranker produced this item
 */

/**
 * @typedef {Object} FusedResult
 * @property {string} name - Entity name
 * @property {number} score - Aggregated RRF score
 * @property {string[]} sources - Ranking list indices that had this item
 */

/**
 * Reciprocal Rank Fusion over multiple ranked lists.
 *
 * @param {Array<Array<{name: string}>>} rankings - Each element is an ordered list (rank 0 = best).
 * @param {{ k?: number, topK?: number }} [opts]
 *   k    — smoothing constant (default 60). Higher k reduces the penalty for lower ranks.
 *   topK — max results to return (default 10, capped at 50).
 * @returns {FusedResult[]} Merged results sorted by descending score, length ≤ topK.
 */
export function rrf(rankings, opts = {}) {
  const k = typeof opts.k === 'number' ? opts.k : 60;
  const topK = Math.min(typeof opts.topK === 'number' ? opts.topK : 10, 50);

  if (!Array.isArray(rankings) || rankings.length === 0) return [];

  // Filter to non-empty lists
  const lists = rankings.filter(list => Array.isArray(list) && list.length > 0);
  if (lists.length === 0) return [];

  // Single list — short-circuit: convert ranks to RRF scores, return top-K
  if (lists.length === 1) {
    return lists[0]
      .slice(0, topK)
      .map((item, rank) => ({
        name: item.name,
        score: 1 / (k + rank + 1),
        sources: ['0'],
      }));
  }

  /** @type {Map<string, { score: number, sources: string[] }>} */
  const acc = new Map();

  for (let i = 0; i < lists.length; i++) {
    const list = lists[i];
    const listKey = String(i);
    for (let rank = 0; rank < list.length; rank++) {
      const { name } = list[rank];
      if (!name) continue;
      const delta = 1 / (k + rank + 1);
      if (acc.has(name)) {
        const entry = acc.get(name);
        entry.score += delta;
        if (!entry.sources.includes(listKey)) entry.sources.push(listKey);
      } else {
        acc.set(name, { score: delta, sources: [listKey] });
      }
    }
  }

  // Sort: descending score, then name for tie-breaking (stable, deterministic)
  const sorted = Array.from(acc.entries())
    .map(([name, { score, sources }]) => ({ name, score, sources }))
    .sort((a, b) => {
      const diff = b.score - a.score;
      if (diff !== 0) return diff;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

  return sorted.slice(0, topK);
}
