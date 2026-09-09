/**
 * brain-schema-registry.mjs — Canonical KG schema, single source of truth.
 *
 * The server accepts free-form `entityType` / `relationType` strings (validating
 * only the [confidence|date] observation prefix), while the auto-memory skill
 * documents a fixed vocabulary. That drift went unnoticed because nothing
 * checked it. This module holds the vocabulary; brain-health reads it to REPORT
 * violations. It deliberately does NOT enforce at write time — that would break
 * agents mid-session.
 */

/** The 13 valid entity types (auto-memory SKILL.md). */
export const ENTITY_TYPES = new Set([
  'biz-domain', 'biz-rule', 'biz-flow', 'biz-entity',
  'pattern-code', 'pattern-arch', 'pattern-integration',
  'tech-stack', 'tech-config', 'tech-person', 'tech-decision',
  'incident-bug', 'incident-gotcha',
]);

/**
 * Allowed TIER prefixes (first name segment) per entity type.
 * Documented convention is TIER:SCOPE:LABEL; the extra prefixes here are ones
 * the graph uses consistently and deliberately (e.g. ENTITY: for biz-entity,
 * DECISION: for tech-decision), so they are adopted rather than flagged.
 */
export const NAME_PREFIXES = {
  'biz-domain': ['BIZ'],
  'biz-rule': ['RULE', 'BIZ'],
  'biz-flow': ['FLOW', 'BIZ'],
  'biz-entity': ['ENTITY', 'BIZ'],
  'pattern-code': ['PATTERN'],
  'pattern-arch': ['PATTERN'],
  'pattern-integration': ['PATTERN'],
  'tech-stack': ['TECH'],
  'tech-config': ['TECH'],
  'tech-person': ['TECH', 'PERSON'],
  'tech-decision': ['TECH', 'DECISION'],
  'incident-bug': ['INCIDENT'],
  'incident-gotcha': ['GOTCHA', 'INCIDENT'],
};

/** Minimum observation count per entity type (auto-memory SKILL.md). */
export const MIN_OBSERVATIONS = {
  'biz-domain': 4, 'biz-rule': 4, 'biz-flow': 4, 'biz-entity': 3,
  'pattern-code': 4, 'pattern-arch': 4, 'pattern-integration': 5,
  'tech-stack': 4, 'tech-config': 3, 'tech-person': 3, 'tech-decision': 5,
  'incident-bug': 6, 'incident-gotcha': 4,
};

/** Required observation key prefixes per entity type (auto-memory SKILL.md). */
export const REQUIRED_OBS_KEYS = {
  'biz-domain': ['WHAT', 'TARGET', 'REVENUE', 'STARTED'],
  'biz-rule': ['RULE', 'CONTEXT', 'VIOLATION', 'FILES'],
  'biz-flow': ['FLOW', 'TRIGGER', 'SIDE_EFFECTS', 'EDGE_CASE'],
  'biz-entity': ['FIELDS', 'STATUSES', 'CONSTRAINTS'],
  'pattern-code': ['WHAT', 'WHEN', 'HOW', 'USED_IN'],
  'pattern-arch': ['WHAT', 'WHEN', 'HOW', 'TRADEOFF'],
  'pattern-integration': ['SERVICE', 'AUTH', 'CALLBACK', 'GOTCHA', 'RETRY'],
  'tech-stack': ['FRONTEND', 'BACKEND', 'INFRA', 'CI_CD'],
  'tech-config': ['ENV', 'URLS', 'CREDENTIALS_HINT'],
  'tech-person': ['ROLE', 'PROJECTS', 'PREFERENCES'],
  'tech-decision': ['DECISION', 'REASON', 'TRADEOFF', 'ALTERNATIVES', 'DATE'],
  'incident-bug': ['SYMPTOM', 'ROOT_CAUSE', 'FIX', 'FILES', 'TIME', 'PROJECT'],
  'incident-gotcha': ['WHAT', 'IMPACT', 'FIX', 'APPLIES_TO'],
};

/** Relation types documented in auto-memory SKILL.md. */
const DOCUMENTED_RELATION_TYPES = [
  'has_rule', 'has_flow', 'has_entity', 'uses_tech', 'uses_pattern', 'leads',
  'works_on', 'reviews', 'decided', 'used_in', 'extends', 'alternative_to',
  'found_in', 'applies_to', 'decided_for', 'depends_on', 'triggers',
  'part_of', 'input_to', 'output_of',
];

/**
 * Relation types not in the doc but used consistently across the graph
 * (>=5 occurrences), so clearly deliberate rather than typos. Adopted into the
 * canonical vocabulary instead of being flagged as 651 violations.
 */
const ADOPTED_RELATION_TYPES = [
  'uses', 'implements', 'implemented_by', 'affects', 'integrates_with',
  'contains', 'enforces', 'enforced_by', 'has_architecture', 'inspired-by',
  'configured_by', 'supersedes', 'documents', 'has_data_model', 'complements',
  'applied_in', 'owns', 'governs', 'governed_by', 'has_incident', 'feeds_into',
  'informs', 'member_of', 'built_with', 'implements_types', 'has_module',
  'involves', 'resolves', 'validates',
];

/** Canonical relation vocabulary. Anything outside is reported, never deleted. */
export const RELATION_TYPES = new Set([
  ...DOCUMENTED_RELATION_TYPES,
  ...ADOPTED_RELATION_TYPES,
]);

/**
 * Tier prefix of an entity name (first ':'-separated segment).
 * @param {string} name
 * @returns {string}
 */
export function namePrefix(name) {
  return String(name).split(':')[0].trim().toUpperCase();
}

/**
 * Observation key prefix (the KEY in "[conf|date] KEY: text").
 * @param {string} text - observation text, prefix already stripped or not
 * @returns {string|null}
 */
export function observationKey(text) {
  const withoutMeta = String(text).replace(/^\[[^\]]*\]\s*/, '');
  const m = withoutMeta.match(/^([A-Z][A-Z0-9_]{1,24})\s*:/);
  return m ? m[1].toUpperCase() : null;
}
