'use strict';
/**
 * F10 — conditional auto-recall gate.
 *
 * Decides whether kg-auto-recall.cjs should fire on a given UserPromptSubmit
 * payload. Bias toward firing (false-positive cheap — extra context never hurt;
 * false-negative expensive — missing biz rule violation).
 *
 * Skip conditions:
 *   - HERMIT_AUTORECALL=off
 *   - Prompt ≤ 8 words AND no code-token signal AND no biz keyword
 *
 * Fire conditions (any one triggers):
 *   - HERMIT_AUTORECALL=always (overrides smart gating)
 *   - Code token: camelCase, PascalCase, snake_case_long, file path, extension
 *   - Code keyword: function/class/import/export/api/route/auth/db/etc.
 *   - Biz keyword: rule/flow/decision/tech stack/architecture/business etc.
 *
 * Returns { fire: boolean, reason: string } so callers can log decisions.
 */

const CODE_KEYWORDS = new Set([
  'function', 'class', 'method', 'import', 'export', 'require', 'module',
  'api', 'route', 'endpoint', 'handler', 'controller', 'service',
  'auth', 'login', 'token', 'session', 'jwt', 'oauth',
  'db', 'sql', 'query', 'schema', 'table', 'migration', 'index',
  'component', 'hook', 'middleware', 'plugin', 'adapter',
  'refactor', 'rename', 'extract', 'inline',
  'test', 'spec', 'suite', 'fixture',
  'bug', 'fix', 'issue', 'error', 'crash', 'stack',
  'deploy', 'build', 'ci', 'cd', 'pipeline',
  'react', 'vue', 'next', 'express', 'fastify', 'nestjs', 'laravel', 'django',
  'payment', 'billing', 'subscription', 'checkout', 'invoice',
]);

const BIZ_KEYWORDS = new Set([
  'rule', 'flow', 'decision', 'architecture', 'pattern', 'business',
  'requirement', 'spec', 'contract', 'invariant',
  'incident', 'gotcha', 'lesson', 'tradeoff',
  'recall', 'remember', 'memory', 'brain',
]);

// Camel/Pascal/snake regex — matches programmer-style identifiers but NOT
// generic English words. Requires at least one transition (case change for
// camel/Pascal, underscore for snake).
const IDENT_RE = /\b(?:[a-z]+(?:[A-Z][a-z]*)+|[A-Z][a-z]+(?:[A-Z][a-z]*)+|[a-z]+(?:_[a-z]+)+)\b/;

// File path or extension — heuristic for paths in prompts.
const PATH_RE = /\b[\w\-./\\]+\.(?:m?[jt]sx?|py|java|go|rs|rb|php|cs|kt|swift|sql|sh|md|json|ya?ml|toml|html|css|sql|xml)\b/;
// Pure relative path: at least two segments separated by / or \.
const PATH_SEP_RE = /\b[\w\-]+[/\\][\w\-./\\]+/;

function hasCodeToken(text) {
  return IDENT_RE.test(text) || PATH_RE.test(text) || PATH_SEP_RE.test(text);
}

function hasKeyword(text, set) {
  const lower = text.toLowerCase();
  for (const k of set) {
    // Word boundary match — avoid 'class' matching inside 'classroom'.
    const re = new RegExp(`\\b${k}\\b`);
    if (re.test(lower)) return true;
  }
  return false;
}

/**
 * Decide whether to fire auto-recall on a prompt.
 * @param {string} prompt
 * @returns {{ fire: boolean, reason: string }}
 */
function shouldFireRecall(prompt) {
  const mode = (process.env.HERMIT_AUTORECALL || 'smart').toLowerCase();
  if (mode === 'off') return { fire: false, reason: 'env: off' };
  if (mode === 'always') return { fire: true, reason: 'env: always' };

  const text = String(prompt || '').trim();
  if (!text) return { fire: false, reason: 'empty' };

  const words = text.split(/\s+/);

  // Long prompts almost always need context — fire.
  if (words.length > 30) return { fire: true, reason: 'long prompt' };

  if (hasCodeToken(text)) return { fire: true, reason: 'code token' };
  if (hasKeyword(text, CODE_KEYWORDS)) return { fire: true, reason: 'code keyword' };
  if (hasKeyword(text, BIZ_KEYWORDS)) return { fire: true, reason: 'biz keyword' };

  // Short, no signal — skip.
  if (words.length <= 8) return { fire: false, reason: 'short + no signal' };

  // Medium-length prompt with no signal — borderline; fire (false-positive cheap).
  return { fire: true, reason: 'medium prompt, fire by default' };
}

module.exports = { shouldFireRecall };
