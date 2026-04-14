#!/usr/bin/env node
/**
 * recall-core.cjs — Shared core logic for all kg-auto-recall hook adapters.
 *
 * Exports pure functions + constants used by:
 *   - kg-auto-recall.cjs         (Claude Code)
 *   - kg-auto-recall-cursor.cjs  (Cursor)
 *   - kg-auto-recall-gemini.cjs  (Gemini CLI)
 *   - kg-auto-recall-cline.cjs   (Cline)
 *
 * Brain path and project scopes are resolved lazily per-call (not module-level
 * constants) because different invocations may have different CWDs/env.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MAX_RESULTS = 5;          // max entities to inject
const MAX_OBS_PER_ENTITY = 3;   // max observations per entity in context
const MIN_KEYWORD_LEN = 3;      // minimum keyword length
const MIN_SCORE = 2;            // minimum match score to include
const SCOPE_BOOST = 3;          // bonus score for entities matching current project
const SCOPE_PENALTY = -2;       // penalty for entities clearly belonging to OTHER projects
const DEFAULT_TOKEN_CAP = 3000; // default token budget for KG injection (~12K chars)
const TASK_TOKEN_CAP = 1500;    // lower budget for subagent task prompts
const MAX_EXPANSION = 3;        // max extra entities from depth-1 relation expansion

// Stopwords — skip these when extracting keywords
const STOPWORDS = new Set([
  // English
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
  // Vietnamese common
  'cái', 'con', 'của', 'cho', 'với', 'trong', 'này', 'đấy', 'đây',
  'thì', 'được', 'không', 'làm', 'sao', 'tui', 'tôi', 'mình',
  'nào', 'bao', 'nhiêu', 'hay', 'hoặc', 'và', 'nhưng', 'vậy',
  'rồi', 'xong', 'xem', 'thử', 'giúp', 'hỏi', 'nói', 'bảo',
  // Code-generic
  'file', 'code', 'function', 'class', 'import', 'export', 'const',
  'var', 'let', 'return', 'async', 'await', 'new', 'true', 'false',
  'null', 'undefined', 'error', 'fix', 'bug', 'add', 'update', 'change',
  'create', 'delete', 'remove', 'move', 'rename', 'refactor', 'test',
  // System/IDE noise — from system-reminders injected by Claude Code
  'ide', 'opened', 'user', 'project', 'personal', 'claude', 'brain',
  'settings', 'json', 'related', 'current', 'task', 'system', 'reminder',
  'selection', 'context', 'workspace', 'session', 'config', 'global',
  'instructions', 'important', 'memory', 'tool', 'tools', 'hooks',
  'command', 'commands', 'skill', 'skills', 'agent', 'model', 'prompt',
  'conversation', 'available', 'working', 'directory', 'contents',
  'result', 'calling', 'input', 'output', 'parameter', 'value',
  'default', 'optional', 'required', 'description', 'example'
]);

// Manual overrides for aliases that can't be auto-detected.
// e.g., directory name "WheelOfFate" should also match entities containing "wof"
const SCOPE_OVERRIDES = {
  'wheeloffate': ['wof', 'wheel'],
  'claudecodebrain': ['brain', 'claudecode'],
  'edumvp': ['edu'],
};

// ═══════════════════════════════════════════════════════════════════════════
// BRAIN PATH RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read MEMORY_FILE_PATH from global ~/.claude/settings.json MCP config.
 * @returns {string|null}
 */
function readMemoryPathFromSettings() {
  // Search multiple config files for MEMORY_FILE_PATH
  const configFiles = [
    path.join(os.homedir(), '.claude.json'),        // user-scope MCP servers
    path.join(os.homedir(), '.claude', 'settings.json'), // legacy location
  ];
  const serverNames = ['hermit-graph', 'memory'];   // current + legacy name

  for (const configPath of configFiles) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const servers = config?.mcpServers || {};
      for (const name of serverNames) {
        const memPath = servers[name]?.env?.MEMORY_FILE_PATH;
        if (memPath && fs.existsSync(memPath)) return memPath;
      }
    } catch { /* ignore parse errors */ }
  }
  return null;
}

// Internal cache — resolved once per process lifetime
let _brainPathCache = null;

/**
 * Resolve brain.jsonl path from env, MCP settings, then common locations.
 * Result is cached after first resolution.
 * @returns {string}
 */
function resolveBrainPath() {
  if (_brainPathCache !== null) return _brainPathCache;

  const candidates = [
    process.env.MEMORY_FILE_PATH,
    readMemoryPathFromSettings(),
    // Relative to this file: catalog/hooks/lib/ -> ../../.. -> repo root -> data/brain.jsonl
    path.join(__dirname, '..', '..', '..', 'data', 'brain.jsonl'),
    path.join(__dirname, '..', '..', 'data', 'brain.jsonl'),
    path.join(os.homedir(), '.claude', 'brain', 'data', 'brain.jsonl'),
    path.join(os.homedir(), 'hermit-graph', 'data', 'brain.jsonl'),
    path.join(os.homedir(), 'claude-code-brain', 'data', 'brain.jsonl'),
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      _brainPathCache = p;
      return p;
    }
  }

  _brainPathCache = candidates[0] || '';
  return _brainPathCache;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROJECT SCOPE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Auto-discover project scopes from brain.jsonl entity names.
 * Extracts the SCOPE part from TIER:SCOPE:LABEL naming pattern.
 * Only reads biz-domain and tech-stack entity types (top-level project markers).
 *
 * @param {string} brainPath - path to brain.jsonl
 * @returns {Object} map { scopeLower: [scopeLower, ...aliases] }
 */
function buildProjectScopes(brainPath) {
  if (!brainPath || !fs.existsSync(brainPath)) return {};

  let lines;
  try { lines = fs.readFileSync(brainPath, 'utf-8').trim().split('\n'); }
  catch { return {}; }

  const scopes = new Set();
  const PROJECT_ENTITY_TYPES = ['biz-domain', 'tech-stack'];

  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'entity' || !obj.name) continue;
    if (!PROJECT_ENTITY_TYPES.includes(obj.entityType)) continue;

    const parts = obj.name.split(':');
    if (parts.length >= 2 && parts[1]) {
      const scope = parts[1].toLowerCase().replace(/[\s-_]/g, '');
      if (scope.length >= 3) scopes.add(scope);
    }
  }

  // Build aliases map: { scope: [scope, ...overrides] }
  const result = {};
  for (const scope of scopes) {
    const aliases = [scope];
    if (SCOPE_OVERRIDES[scope]) {
      aliases.push(...SCOPE_OVERRIDES[scope]);
    }
    // Check if any override key maps TO this scope
    for (const [overrideKey, overrideAliases] of Object.entries(SCOPE_OVERRIDES)) {
      if (overrideAliases.includes(scope) && !aliases.includes(overrideKey)) {
        aliases.push(overrideKey);
      }
    }
    result[scope] = [...new Set(aliases)];
  }

  return result;
}

/**
 * Detect current project scope from an explicit directory path.
 * Walks from deepest to shallowest directory component looking for a known scope.
 *
 * @param {string} cwdPath - directory path to inspect
 * @returns {string[]} array of lowercase scope keywords to match against entity names
 */
function detectProjectScopeFromPath(cwdPath) {
  const brainPath = resolveBrainPath();
  const projectScopes = buildProjectScopes(brainPath);

  const normalized = (cwdPath || '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);

  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts[i].toLowerCase().replace(/[\s-_]/g, '');
    for (const [scope, aliases] of Object.entries(projectScopes)) {
      if (aliases.some(a => dir.includes(a)) || dir.includes(scope)) {
        return aliases;
      }
    }
  }

  // Fallback: use last directory name as-is
  const lastDir = (parts[parts.length - 1] || '').toLowerCase().replace(/[\s-_]/g, '');
  return lastDir.length >= 3 ? [lastDir] : [];
}

/**
 * Detect current project scope from process.env.CWD or process.cwd().
 * @returns {string[]} array of lowercase scope keywords
 */
function detectProjectScope() {
  return detectProjectScopeFromPath(process.env.CWD || process.cwd());
}

/**
 * Check whether an entity name belongs to the current project scope.
 * Uses module-level projectScopes derived from brainPath at call time.
 *
 * @param {string} entityName
 * @param {string[]} currentScope
 * @returns {'match'|'other'|'neutral'}
 */
function checkEntityScope(entityName, currentScope) {
  if (currentScope.length === 0) return 'neutral';
  const nameLower = entityName.toLowerCase().replace(/[\s-_]/g, '');

  if (currentScope.some(s => nameLower.includes(s))) return 'match';

  // Check against all known project scopes (resolved fresh each call)
  const brainPath = resolveBrainPath();
  const projectScopes = buildProjectScopes(brainPath);

  for (const [, aliases] of Object.entries(projectScopes)) {
    if (aliases.some(a => currentScope.includes(a))) continue; // same project
    if (aliases.some(a => nameLower.includes(a))) return 'other';
  }

  return 'neutral'; // Generic entities (PATTERN:*, TECH:Decision:*, etc.)
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORD EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract meaningful keywords from a prompt string.
 * Splits on non-alphanumeric chars, filters stopwords and short tokens.
 *
 * @param {string} prompt
 * @returns {string[]} deduplicated keyword array
 */
function extractKeywords(prompt) {
  const words = prompt
    .toLowerCase()
    .split(/[\s\-_:;,.!?()[\]{}"'`\/\\|<>@#$%^&*+=~]+/)
    .filter(w => w.length >= MIN_KEYWORD_LEN && !STOPWORDS.has(w));

  return [...new Set(words)];
}

// ═══════════════════════════════════════════════════════════════════════════
// BRAIN SEARCH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize an observation value to a plain string.
 * Handles string, {content: string}, and anything else.
 *
 * @param {*} obs
 * @returns {string}
 */
function normalizeObs(obs) {
  if (typeof obs === 'string') return obs;
  if (typeof obs === 'object' && obs !== null && 'content' in obs) return obs.content;
  return String(obs);
}

/**
 * Search brain.jsonl for entities matching the given keywords.
 * Applies project-scope boosting/penalty to the score.
 *
 * @param {string[]} keywords
 * @param {string[]} projectScope - from detectProjectScope()
 * @returns {Array<{name, entityType, observations, score, matchedKeywords}>}
 */
function searchBrain(keywords, projectScope) {
  const brainPath = resolveBrainPath();
  if (!brainPath || !fs.existsSync(brainPath)) return [];

  let lines;
  try {
    lines = fs.readFileSync(brainPath, 'utf-8').trim().split('\n');
  } catch {
    return [];
  }

  const results = [];

  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'entity') continue;

    const name = (obj.name || '').toLowerCase();
    const entityType = (obj.entityType || '').toLowerCase();
    const obsTexts = (obj.observations || []).map(o => normalizeObs(o).toLowerCase());
    const allText = [name, entityType, ...obsTexts].join(' ');

    let score = 0;
    const matchedKeywords = [];

    for (const kw of keywords) {
      if (name.includes(kw)) {
        score += 5;
        matchedKeywords.push(kw);
      } else if (obsTexts.some(o => o.includes(kw))) {
        score += 2;
        matchedKeywords.push(kw);
      } else if (allText.includes(kw)) {
        score += 1;
        matchedKeywords.push(kw);
      }
    }

    if (score >= MIN_SCORE) {
      const scope = checkEntityScope(obj.name, projectScope);
      if (scope === 'match') score += SCOPE_BOOST;
      else if (scope === 'other') score += SCOPE_PENALTY;

      // Skip if score dropped below threshold after penalty
      if (score >= MIN_SCORE) {
        results.push({
          name: obj.name,
          entityType: obj.entityType,
          observations: (obj.observations || []).map(normalizeObs),
          score,
          matchedKeywords: [...new Set(matchedKeywords)]
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, MAX_RESULTS);
}

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN BUDGET ESTIMATION (Phase 2)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Estimate character count of injection output at a given detail level.
 * @param {Array} results - from searchBrain()
 * @param {'compact'|'standard'|'full'} level
 * @returns {number} estimated character count
 */
function estimateChars(results, level) {
  let total = 120; // header + footer overhead
  for (const r of results) {
    // Name + type header: "### NAME (type)\n"
    const header = r.name.length + (r.entityType || '').length + 10;
    if (level === 'compact') {
      total += header;
    } else if (level === 'standard') {
      const firstObs = r.observations[0] || '';
      total += header + firstObs.length + 4; // "- obs\n"
    } else { // full
      const obsToShow = r.observations.slice(0, MAX_OBS_PER_ENTITY);
      total += header + obsToShow.reduce((sum, o) => sum + o.length + 4, 0);
      if (r.observations.length > MAX_OBS_PER_ENTITY) total += 60; // "... +N more" line
    }
  }
  return total;
}

/**
 * Auto-select detail level based on token budget.
 * Reads HERMIT_RECALL_TOKEN_CAP from env (default: DEFAULT_TOKEN_CAP).
 * @param {Array} results - from searchBrain()
 * @param {number} [capOverride] - optional cap override (for task prompts)
 * @returns {'compact'|'standard'|'full'}
 */
function selectDetailLevel(results, capOverride) {
  const cap = capOverride || parseInt(process.env.HERMIT_RECALL_TOKEN_CAP || String(DEFAULT_TOKEN_CAP));
  const charCap = cap * 4; // chars/4 token estimation

  if (estimateChars(results, 'full') <= charCap) return 'full';
  if (estimateChars(results, 'standard') <= charCap) return 'standard';
  return 'compact';
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT TYPE DETECTION (Phase 5)
// ═══════════════════════════════════════════════════════════════════════════

/** Task-style prompt signal patterns (subagent Task tool payloads). */
const TASK_SIGNALS = [
  /^Task:/m,
  /Files to (?:modify|read|create):/i,
  /Acceptance criteria:/i,
  /Work context:/i,
  /Implementation Steps:/i,
];

/**
 * Detect whether a prompt is a task-style (subagent) or conversational (user).
 * Requires 2+ signals to classify as task (reduce false positives).
 * @param {string} prompt
 * @returns {'task'|'conversational'}
 */
function detectPromptType(prompt) {
  const hits = TASK_SIGNALS.filter(r => r.test(prompt)).length;
  return hits >= 2 ? 'task' : 'conversational';
}

/**
 * Extract keywords specialized for task-style prompts.
 * Focuses on file paths, entity refs, backtick-quoted terms, and capped standard keywords.
 * @param {string} prompt
 * @returns {string[]}
 */
function extractTaskKeywords(prompt) {
  const keywords = new Set();

  // 1. File paths → extract directory/file name parts
  const filePaths = prompt.match(/([\w\-]+\/)+[\w\-]+\.\w+/g) || [];
  for (const p of filePaths) {
    for (const seg of p.split('/')) {
      const clean = seg.replace(/\.\w+$/, '').toLowerCase();
      if (clean.length > 3 && !STOPWORDS.has(clean)) keywords.add(clean);
    }
  }

  // 2. Explicit entity refs (TIER:SCOPE:LABEL)
  const entityRefs = prompt.match(/(?:BIZ|TECH|PATTERN|INCIDENT):[A-Za-z:]+/g) || [];
  for (const e of entityRefs) keywords.add(e.toLowerCase());

  // 3. Backtick-quoted terms
  const backticks = prompt.match(/`([^`]{3,30})`/g) || [];
  for (const b of backticks) keywords.add(b.replace(/`/g, '').toLowerCase());

  // 4. Fall back to standard extraction, capped at 5
  const standard = extractKeywords(prompt);
  for (const k of standard.slice(0, 5)) keywords.add(k);

  return [...keywords];
}

// ═══════════════════════════════════════════════════════════════════════════
// RELATION EXPANSION (Phase 5)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Expand results with depth-1 related entities from brain.jsonl.
 * Reads relations, finds entities connected to result set, looks up their data.
 * @param {Array} results - from searchBrain()
 * @param {string} brainPath - path to brain.jsonl
 * @returns {Array} additional entity objects (max MAX_EXPANSION)
 */
function expandRelations(results, brainPath) {
  if (!brainPath || !fs.existsSync(brainPath)) return [];

  let lines;
  try { lines = fs.readFileSync(brainPath, 'utf-8').trim().split('\n'); }
  catch { return []; }

  const entityNames = new Set(results.map(r => r.name));
  const relatedNames = new Set();

  // Pass 1: find related entity names from relations
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'relation') continue;
    if (entityNames.has(obj.from) && !entityNames.has(obj.to)) {
      relatedNames.add(obj.to);
    }
    if (entityNames.has(obj.to) && !entityNames.has(obj.from)) {
      relatedNames.add(obj.from);
    }
  }

  if (relatedNames.size === 0) return [];

  // Cap early to avoid unnecessary parsing
  const targetNames = [...relatedNames].slice(0, MAX_EXPANSION);

  // Pass 2: lookup entity data for related names
  const expanded = [];
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'entity') continue;
    if (targetNames.includes(obj.name)) {
      expanded.push({
        name: obj.name,
        entityType: obj.entityType,
        observations: (obj.observations || []).map(normalizeObs),
        score: 0, // expansion, not direct match
        matchedKeywords: ['(expanded)'],
      });
      if (expanded.length >= MAX_EXPANSION) break;
    }
  }

  return expanded;
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMAT OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format search results into a markdown block for injection into LLM context.
 * Supports token-aware detail levels: full (default), standard, compact.
 *
 * @param {Array} results - from searchBrain()
 * @param {string[]} keywords
 * @param {string[]} projectScope
 * @param {'compact'|'standard'|'full'|null} [detailLevel=null] - auto-detect if null
 * @returns {string|null} markdown text, or null if no results
 */
function formatResults(results, keywords, projectScope, detailLevel) {
  if (results.length === 0) return null;

  const level = detailLevel || selectDetailLevel(results);

  // Debug logging when downgraded
  if (level !== 'full') {
    const tokens = Math.ceil(estimateChars(results, level) / 4);
    process.stderr.write(`[hermit] KG recall: ${level} (${results.length} entities, ~${tokens} tokens)\n`);
  }

  const scopeLabel = projectScope.length > 0 ? projectScope[0] : 'global';
  const lines = [
    `## KG Memory Recall (auto${scopeLabel !== 'global' ? ', scope: ' + scopeLabel : ''})`,
    `Keywords: ${keywords.join(', ')}`,
    `Found ${results.length} relevant entities in Knowledge Graph:`,
    ``
  ];

  for (const r of results) {
    if (level === 'compact') {
      lines.push(`### ${r.name} (${r.entityType})`);
    } else if (level === 'standard') {
      lines.push(`### ${r.name} (${r.entityType})`);
      if (r.observations[0]) lines.push(`- ${r.observations[0]}`);
    } else { // full
      lines.push(`### ${r.name} (${r.entityType})`);
      const obsToShow = r.observations.slice(0, MAX_OBS_PER_ENTITY);
      for (const obs of obsToShow) {
        lines.push(`- ${obs}`);
      }
      if (r.observations.length > MAX_OBS_PER_ENTITY) {
        lines.push(`- ... +${r.observations.length - MAX_OBS_PER_ENTITY} more (use open_nodes("${r.name}") for full details)`);
      }
    }
    lines.push(``);
  }

  lines.push(`> Use open_nodes() for full entity details. Use search_nodes() for broader search.`);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// HIGH-LEVEL RECALL (orchestrates Phase 2 + Phase 5)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Smart recall: detects prompt type, extracts keywords, searches brain,
 * optionally expands relations for task prompts, formats with token budget.
 *
 * Drop-in replacement for the manual extractKeywords→searchBrain→formatResults chain.
 *
 * @param {string} prompt - user or task prompt
 * @returns {string|null} formatted output, or null if no results
 */
function recall(prompt) {
  const promptType = detectPromptType(prompt);
  const projectScope = detectProjectScope();

  // Keyword extraction: task-aware vs standard
  const keywords = promptType === 'task'
    ? extractTaskKeywords(prompt)
    : extractKeywords(prompt);

  if (keywords.length === 0) return null;

  let results = searchBrain(keywords, projectScope);
  if (results.length === 0) return null;

  // Depth-1 relation expansion for task prompts
  if (promptType === 'task') {
    const brainPath = resolveBrainPath();
    const expanded = expandRelations(results, brainPath);
    if (expanded.length > 0) results = [...results, ...expanded];
  }

  // Token budget: task prompts get lower cap
  const tokenCap = promptType === 'task' ? TASK_TOKEN_CAP : undefined;
  const level = selectDetailLevel(results, tokenCap);

  return formatResults(results, keywords, projectScope, level);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // High-level
  recall,
  // Functions
  resolveBrainPath,
  buildProjectScopes,
  detectProjectScope,
  detectProjectScopeFromPath,
  checkEntityScope,
  extractKeywords,
  extractTaskKeywords,
  searchBrain,
  formatResults,
  normalizeObs,
  // Phase 2: Token budgeting
  estimateChars,
  selectDetailLevel,
  // Phase 5: Task detection + expansion
  detectPromptType,
  expandRelations,
  // Constants
  STOPWORDS,
  MIN_KEYWORD_LEN,
  MIN_SCORE,
  MAX_RESULTS,
  MAX_OBS_PER_ENTITY,
  SCOPE_BOOST,
  SCOPE_PENALTY,
  DEFAULT_TOKEN_CAP,
  TASK_TOKEN_CAP,
  MAX_EXPANSION,
};
