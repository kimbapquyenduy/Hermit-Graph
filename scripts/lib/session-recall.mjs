/**
 * session-recall.mjs — Shared scoring logic for session-start context injection.
 *
 * ESM version of the scoring algorithm from kg-auto-recall.cjs.
 * Used by session-module.mjs (MCP tool + resource) to provide
 * project-scoped KG context to ALL agents (not just Claude Code).
 */

import { readBrain } from './brain-io.mjs';
import { STOP_WORDS as SHARED_STOP_WORDS } from './memory-search-scoring.mjs';

// ── Config ──────────────────────────────────────────────────────────────
const MIN_KEYWORD_LEN = 3;
const MIN_SCORE = 2;
const SCOPE_BOOST = 3;
const SCOPE_PENALTY = -2;

// Manual aliases for project names that can't be auto-detected from directory
const SCOPE_OVERRIDES = {
  wheeloffate: ['wof', 'wheel'],
  // HermitGraph / HermitMCP / HermitV4 are all this same repo — without the
  // aliases the scope filter reads them as a different project and hides them.
  claudecodebrain: ['brain', 'claudecode', 'hermitgraph', 'hermit', 'hermitmcp', 'hermitv4'],
  edumvp: ['edu'],
};

// Stopwords — skip when extracting keywords
const STOPWORDS = new Set([
  'the', 'this', 'that', 'what', 'which', 'where', 'when', 'how', 'why',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might',
  'have', 'has', 'had', 'been', 'being', 'are', 'was', 'were', 'does',
  'did', 'doing', 'done', 'not', 'but', 'and', 'for', 'with', 'from',
  'into', 'about', 'between', 'through', 'after', 'before', 'above',
  'below', 'some', 'any', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'than', 'then', 'also', 'just', 'only', 'very',
  'too', 'here', 'there', 'now', 'still', 'already', 'yet', 'even',
  'let', 'make', 'use', 'get', 'got', 'want', 'need', 'try', 'help',
  'please', 'thanks', 'thank', 'okay', 'yes', 'sure', 'right',
  'file', 'code', 'function', 'class', 'import', 'export', 'const',
  'var', 'return', 'async', 'await', 'new', 'true', 'false',
  'null', 'undefined', 'error', 'fix', 'bug', 'add', 'update', 'change',
  'create', 'delete', 'remove', 'move', 'rename', 'refactor', 'test',
  'ide', 'opened', 'user', 'project', 'personal', 'claude', 'brain',
  'settings', 'json', 'related', 'current', 'task', 'system', 'reminder',
  'selection', 'context', 'workspace', 'session', 'config', 'global',
  'instructions', 'important', 'memory', 'tool', 'tools', 'hooks',
  'command', 'commands', 'skill', 'skills', 'agent', 'model', 'prompt',
  'conversation', 'available', 'working', 'directory', 'contents',
  'result', 'calling', 'input', 'output', 'parameter', 'value',
  'default', 'optional', 'required', 'description', 'example',
]);

// ── Keyword Extraction ──────────────────────────────────────────────────

/**
 * Extract meaningful keywords from text, filtering stopwords.
 * Merges the shared (English + Vietnamese) stopword list so non-English prompts
 * don't turn every filler word into a search term.
 */
export function extractKeywords(text) {
  return [...new Set(
    text.toLowerCase()
      .split(/[\s\-_:;,.!?()[\]{}"'`/\\|<>@#$%^&*+=~]+/)
      .filter(w => w.length >= MIN_KEYWORD_LEN && !STOPWORDS.has(w) && !SHARED_STOP_WORDS.has(w))
  )];
}

// ── Scope Detection ─────────────────────────────────────────────────────

/** Build project scope map from brain.jsonl entity names (biz-domain + tech-stack). */
function buildProjectScopes(brainPath) {
  const { entities } = readBrain(brainPath);
  const scopes = new Set();

  for (const [, entity] of entities) {
    if (!['biz-domain', 'tech-stack'].includes(entity.entityType)) continue;
    const parts = entity.name.split(':');
    if (parts.length >= 2 && parts[1]) {
      const scope = parts[1].toLowerCase().replace(/[\s\-_]/g, '');
      if (scope.length >= 3) scopes.add(scope);
    }
  }

  const result = {};
  for (const scope of scopes) {
    const aliases = [scope];
    if (SCOPE_OVERRIDES[scope]) aliases.push(...SCOPE_OVERRIDES[scope]);
    for (const [key, vals] of Object.entries(SCOPE_OVERRIDES)) {
      if (vals.includes(scope) && !aliases.includes(key)) aliases.push(key);
    }
    result[scope] = [...new Set(aliases)];
  }
  return result;
}

/** Detect current project scope from CWD path segments. */
export function detectScope(cwd, brainPath) {
  const scopes = buildProjectScopes(brainPath);
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);

  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts[i].toLowerCase().replace(/[\s\-_]/g, '');
    for (const [scope, aliases] of Object.entries(scopes)) {
      if (aliases.some(a => dir.includes(a)) || dir.includes(scope)) {
        return { scope: aliases[0], aliases, allScopes: scopes };
      }
    }
  }

  const lastDir = (parts[parts.length - 1] || '').toLowerCase().replace(/[\s\-_]/g, '');
  return {
    scope: lastDir.length >= 3 ? lastDir : 'global',
    aliases: lastDir.length >= 3 ? [lastDir] : [],
    allScopes: scopes,
  };
}

/**
 * Check if entity belongs to current scope, another scope, or neutral.
 * Exported so memory search tools scope results the same way session recall does
 * (one scope resolver, not two).
 */
export function checkEntityScope(entityName, currentAliases, allScopes) {
  if (currentAliases.length === 0) return 'neutral';
  const nameLower = entityName.toLowerCase().replace(/[\s\-_]/g, '');

  if (currentAliases.some(a => nameLower.includes(a))) return 'match';

  for (const [, aliases] of Object.entries(allScopes)) {
    if (aliases.some(a => currentAliases.includes(a))) continue;
    if (aliases.some(a => nameLower.includes(a))) return 'other';
  }
  return 'neutral';
}

// ── Normalize Observations ──────────────────────────────────────────────

function normalizeObs(obs) {
  if (typeof obs === 'string') return obs;
  if (typeof obs === 'object' && obs !== null && 'content' in obs) return obs.content;
  return String(obs);
}

// ── Core Recall ─────────────────────────────────────────────────────────

/**
 * Search brain.jsonl for entities matching query/scope with weighted scoring.
 * @param {string} brainPath
 * @param {object} opts
 * @param {string} [opts.query=''] - Text to extract keywords from
 * @param {string} [opts.cwd] - Working directory for scope detection
 * @param {number} [opts.maxResults=5]
 * @param {number} [opts.maxObsPerEntity=3]
 * @param {boolean} [opts.crossProject=false] - Include entities owned by other projects
 * @returns {{ entities: Array, scope: string, keywords: string[], crossProjectFallback: boolean }}
 */
export function recallEntities(brainPath, opts = {}) {
  const { query = '', cwd = process.cwd(), maxResults = 5, maxObsPerEntity = 3, crossProject = false } = opts;
  const { scope, aliases, allScopes } = detectScope(cwd, brainPath);
  const keywords = query ? extractKeywords(query) : [];
  const { entities: entityMap } = readBrain(brainPath);

  // If no keywords, return top entities by scope match only
  const useKeywords = keywords.length > 0;
  const results = [];

  for (const [, entity] of entityMap) {
    if (entity._archived) continue;

    const name = (entity.name || '').toLowerCase();
    const obsTexts = (entity.observations || []).map(o => normalizeObs(o).toLowerCase());
    const allText = [name, entity.entityType || '', ...obsTexts].join(' ');

    let score = 0;
    if (useKeywords) {
      for (const kw of keywords) {
        if (name.includes(kw)) score += 5;
        else if (obsTexts.some(o => o.includes(kw))) score += 2;
        else if (allText.includes(kw)) score += 1;
      }
      if (score < MIN_SCORE) continue;
    }

    // Apply scope scoring
    const scopeResult = checkEntityScope(entity.name, aliases, allScopes);
    if (scopeResult === 'match') score += SCOPE_BOOST;
    else if (scopeResult === 'other') score += SCOPE_PENALTY;

    // For scope-only mode (no keywords), only include matching entities
    if (!useKeywords && scopeResult !== 'match') continue;
    if (score < MIN_SCORE && useKeywords) continue;

    results.push({
      name: entity.name,
      entityType: entity.entityType,
      observations: (entity.observations || []).map(normalizeObs).slice(0, maxObsPerEntity),
      score,
      scopeResult,
    });
  }

  results.sort((a, b) => b.score - a.score);

  // Entities that clearly belong to ANOTHER project are excluded by default.
  // SCOPE_PENALTY alone never won against keyword hits: a generic prompt could
  // rank another project's incidents above the current project's own knowledge.
  // 'neutral' (no recognizable project in the name — shared patterns) stays.
  let visible = crossProject ? results : results.filter(r => r.scopeResult !== 'other');
  let crossProjectFallback = false;
  if (!visible.length && results.length) { visible = results; crossProjectFallback = true; }

  return {
    entities: visible.slice(0, maxResults),
    scope,
    keywords,
    crossProjectFallback,
  };
}
