/**
 * Deterministic test fixture generator for memory provider benchmarks + contract tests.
 * Uses mulberry32 PRNG — same seed always produces identical output.
 * Output is synthetic only — never reads from user's real brain.jsonl.
 */

/** All 13 valid entity types per CLAUDE.md naming rules. */
const ENTITY_TYPES = [
  'biz-domain', 'biz-rule', 'biz-flow', 'biz-entity',
  'pattern-code', 'pattern-arch', 'pattern-integration',
  'tech-stack', 'tech-config', 'tech-person', 'tech-decision',
  'incident-bug', 'incident-gotcha',
];

/** Tier prefixes matched to entity types for realistic names. */
const TIER_MAP = {
  'biz-domain': 'BIZ', 'biz-rule': 'RULE', 'biz-flow': 'FLOW', 'biz-entity': 'ENTITY',
  'pattern-code': 'PATTERN', 'pattern-arch': 'PATTERN', 'pattern-integration': 'PATTERN',
  'tech-stack': 'TECH', 'tech-config': 'TECH', 'tech-person': 'TECH', 'tech-decision': 'TECH',
  'incident-bug': 'INCIDENT', 'incident-gotcha': 'GOTCHA',
};

const SCOPE_WORDS = [
  'Auth', 'Payment', 'Order', 'User', 'Search', 'Cache', 'Queue', 'Event',
  'Report', 'Webhook', 'Session', 'Token', 'Config', 'Import', 'Export',
];

const LABEL_WORDS = [
  'MaxRetry', 'Timeout', 'RateLimit', 'BatchSize', 'Threshold', 'Strategy',
  'Pattern', 'Handler', 'Factory', 'Registry', 'Adapter', 'Gateway', 'Service',
  'Pipeline', 'Validator', 'Parser', 'Encoder', 'Dispatcher', 'Scheduler',
];

const OBS_VERBS = [
  'RULE', 'WHAT', 'HOW', 'WHY', 'WHEN', 'STACK', 'FLOW',
  'DECISION', 'CONTEXT', 'NOTE', 'DETAIL', 'STATUS',
];

const CONFIDENCES = ['0.6', '0.7', '0.8', '0.9', '0.95'];

/**
 * mulberry32 — simple deterministic PRNG.
 * @param {number} seed
 * @returns {() => number} function returning float in [0, 1)
 */
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick a random element from array using provided rng.
 * @template T
 * @param {T[]} arr
 * @param {() => number} rng
 * @returns {T}
 */
function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Generate a valid [confidence|YYYY-MM-DD] prefixed observation.
 * Date is fixed to 2026-01-01 for full determinism.
 * @param {number} index
 * @param {() => number} rng
 * @returns {string}
 */
function makeObservation(index, rng) {
  const conf = pick(CONFIDENCES, rng);
  const verb = pick(OBS_VERBS, rng);
  // Fixed date — no real Date.now() to keep output fully deterministic
  return `[${conf}|2026-01-01] ${verb}: synthetic observation ${index} for benchmark fixture`;
}

/**
 * Generate a sample vault with deterministic entities and relations.
 * @param {{ size?: number, seed?: number }} [opts]
 * @param {number} [opts.size=500] Number of entities to generate
 * @param {number} [opts.seed=42]  PRNG seed
 * @returns {{ entities: Map<string, object>, relations: object[] }}
 */
export function generateSampleVault({ size = 500, seed = 42 } = {}) {
  const rng = mulberry32(seed);
  const entities = new Map();
  const names = [];

  for (let i = 0; i < size; i++) {
    const entityType = ENTITY_TYPES[i % ENTITY_TYPES.length];
    const tier = TIER_MAP[entityType];
    const scope = pick(SCOPE_WORDS, rng);
    const label = pick(LABEL_WORDS, rng);
    // Append index to guarantee uniqueness even when scope+label collide
    const name = `${tier}:${scope}:${label}${i}`;

    const obsCount = 1 + Math.floor(rng() * 4); // 1-4 observations per entity
    const observations = [];
    for (let j = 0; j < obsCount; j++) {
      observations.push(makeObservation(i * 10 + j, rng));
    }

    entities.set(name, { type: 'entity', name, entityType, observations });
    names.push(name);
  }

  // Generate ~200 relations (roughly size * 0.4, capped)
  const relCount = Math.min(200, Math.floor(size * 0.4));
  const relations = [];
  const REL_TYPES = ['uses', 'depends_on', 'implements', 'caused_by', 'extends'];
  const seen = new Set();

  for (let i = 0; i < relCount; i++) {
    const from = names[Math.floor(rng() * names.length)];
    const to = names[Math.floor(rng() * names.length)];
    const relationType = pick(REL_TYPES, rng);
    const key = `${from}|${to}|${relationType}`;
    if (from === to || seen.has(key)) continue;
    seen.add(key);
    relations.push({ type: 'relation', from, to, relationType });
  }

  return { entities, relations };
}
