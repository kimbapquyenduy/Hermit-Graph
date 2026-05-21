/**
 * F11 — feature-request heuristic.
 *
 * Detects whether a user task description looks like a feature request
 * (vs bug fix or exploration). When detected, hermit_context appends a
 * lightweight reminder to clarify UX/edge cases before implementation —
 * saves wasted exploration on under-specified features.
 *
 * Tiny token cost (~20), saves hundreds of tokens on misdirected work.
 */

const FEATURE_KEYWORDS = [
  'add', 'create', 'implement', 'build', 'enable', 'allow',
  'new feature', 'support for', 'ability to', 'want to',
  'should be able', 'need to add',
];

const BUG_KEYWORDS = [
  'fix', 'bug', 'error', 'broken', 'crash', 'issue', 'problem',
  'not working', 'fails', 'undefined', 'null',
];

const EXPLORATION_KEYWORDS = [
  'how does', 'where is', 'what is', 'find', 'show me',
  'explain', 'understand', 'explore',
];

/**
 * Classify a task into 'feature' | 'bug' | 'exploration' | 'other'.
 * @param {string} task
 * @returns {'feature' | 'bug' | 'exploration' | 'other'}
 */
export function classifyTask(task) {
  const lower = String(task || '').toLowerCase();
  // Bug + exploration win over feature when both present.
  if (BUG_KEYWORDS.some(k => lower.includes(k))) return 'bug';
  if (EXPLORATION_KEYWORDS.some(k => lower.includes(k))) return 'exploration';
  if (FEATURE_KEYWORDS.some(k => lower.includes(k))) return 'feature';
  return 'other';
}

/**
 * Lightweight reminder appended to context output when query looks like
 * a feature request. Empty string otherwise.
 * @param {string} task
 * @returns {string}
 */
export function featureRequestReminder(task) {
  return classifyTask(task) === 'feature'
    ? '\n\n⚠️ Feature request — clarify UX preferences, edge cases, acceptance criteria with user before implementing.'
    : '';
}
