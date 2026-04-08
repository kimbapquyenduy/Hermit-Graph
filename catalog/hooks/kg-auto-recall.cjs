#!/usr/bin/env node
/**
 * kg-auto-recall.cjs — UserPromptSubmit Hook (Global)
 *
 * Automatically searches brain.jsonl for entities matching the user's prompt
 * and injects matching KG context BEFORE Claude starts responding.
 *
 * This ensures Claude always has relevant memory context without relying
 * on the LLM remembering to call search_nodes manually.
 *
 * Flow:
 *   1. Read user prompt from stdin
 *   2. Extract keywords (skip stopwords, min 3 chars)
 *   3. Search brain.jsonl entity names + observations
 *   4. Output top matches as additionalContext
 *
 * Exit Codes:
 *   0 - Success (non-blocking)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

// brain.jsonl path — resolve from env, MCP config, then common locations
function readMemoryPathFromSettings() {
  // Read MEMORY_FILE_PATH from global ~/.claude/settings.json MCP config
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (!fs.existsSync(settingsPath)) return null;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const memoryEnv = settings?.mcpServers?.memory?.env?.MEMORY_FILE_PATH;
    if (memoryEnv && fs.existsSync(memoryEnv)) return memoryEnv;
  } catch { /* ignore parse errors */ }
  return null;
}

function resolveBrainPath() {
  const candidates = [
    process.env.MEMORY_FILE_PATH,
    readMemoryPathFromSettings(),
    path.join(__dirname, '..', '..', 'data', 'brain.jsonl'),
    path.join(os.homedir(), '.claude', 'brain', 'data', 'brain.jsonl'),
    path.join(os.homedir(), 'hermit-graph', 'data', 'brain.jsonl'),
    path.join(os.homedir(), 'claude-code-brain', 'data', 'brain.jsonl'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0] || '';
}
const BRAIN_PATH = resolveBrainPath();

const MAX_RESULTS = 5;          // max entities to inject
const MAX_OBS_PER_ENTITY = 3;   // max observations per entity in context
const MIN_KEYWORD_LEN = 3;      // minimum keyword length
const MIN_SCORE = 2;            // minimum match score to include
const SCOPE_BOOST = 3;          // bonus score for entities matching current project
const SCOPE_PENALTY = -2;       // penalty for entities clearly belonging to OTHER projects

// ═══════════════════════════════════════════════════════════════════════════
// PROJECT SCOPE DETECTION (auto-discovered from brain.jsonl)
// ═══════════════════════════════════════════════════════════════════════════

// Manual overrides for aliases that can't be auto-detected
// e.g., directory name "WheelOfFate" should also match entities containing "wof"
const SCOPE_OVERRIDES = {
  'wheeloffate': ['wof', 'wheel'],
  'claudecodebrain': ['brain', 'claudecode'],
  'edumvp': ['edu'],
};

/**
 * Auto-discover project scopes from brain.jsonl entity names.
 * Extracts the SCOPE part from TIER:SCOPE:LABEL naming pattern.
 * Returns map: { scopeLower: [scopeLower, ...aliases] }
 */
function buildProjectScopes() {
  if (!fs.existsSync(BRAIN_PATH)) return {};

  let lines;
  try { lines = fs.readFileSync(BRAIN_PATH, 'utf-8').trim().split('\n'); }
  catch { return {}; }

  const scopes = new Set();

  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'entity' || !obj.name) continue;

    // Only extract project scopes from top-level project entities
    // biz-domain = project business definition, tech-stack = project tech definition
    // This avoids sub-modules (Module10HR), flows (EInvoiceFlow), patterns (ARCH)
    const PROJECT_ENTITY_TYPES = ['biz-domain', 'tech-stack'];
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
    // Add manual overrides if any
    if (SCOPE_OVERRIDES[scope]) {
      aliases.push(...SCOPE_OVERRIDES[scope]);
    }
    // Also check if any override key maps TO this scope
    for (const [overrideKey, overrideAliases] of Object.entries(SCOPE_OVERRIDES)) {
      if (overrideAliases.includes(scope) && !aliases.includes(overrideKey)) {
        aliases.push(overrideKey);
      }
    }
    result[scope] = [...new Set(aliases)];
  }

  return result;
}

// Build once at startup (brain.jsonl is read anyway for search)
const PROJECT_SCOPES = buildProjectScopes();

/**
 * Detect current project scope from CWD.
 * Returns array of lowercase scope keywords to match against entity names.
 */
function detectProjectScope() {
  const cwd = (process.env.CWD || process.cwd()).replace(/\\/g, '/');
  const parts = cwd.split('/').filter(Boolean);

  // Walk from end to find a known project directory
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts[i].toLowerCase().replace(/[\s-_]/g, '');
    for (const [scope, aliases] of Object.entries(PROJECT_SCOPES)) {
      // Check if directory matches scope or any alias
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
 * Check if an entity name belongs to a specific project scope.
 * Returns: 'match' | 'other' | 'neutral'
 */
function checkEntityScope(entityName, currentScope) {
  if (currentScope.length === 0) return 'neutral';
  const nameLower = entityName.toLowerCase().replace(/[\s-_]/g, '');

  // Check if entity matches current project
  if (currentScope.some(s => nameLower.includes(s))) return 'match';

  // Check if entity clearly belongs to ANOTHER project
  for (const [, aliases] of Object.entries(PROJECT_SCOPES)) {
    // Skip if these aliases overlap with current scope
    if (aliases.some(a => currentScope.includes(a))) continue;
    if (aliases.some(a => nameLower.includes(a))) return 'other';
  }

  return 'neutral'; // Generic entities (PATTERN:*, TECH:Decision:*, etc.)
}

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

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORD EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

function extractKeywords(prompt) {
  // Split on non-alphanumeric (keep unicode for Vietnamese)
  const words = prompt
    .toLowerCase()
    .split(/[\s\-_:;,.!?()[\]{}"'`\/\\|<>@#$%^&*+=~]+/)
    .filter(w => w.length >= MIN_KEYWORD_LEN && !STOPWORDS.has(w));

  // Deduplicate
  return [...new Set(words)];
}

// ═══════════════════════════════════════════════════════════════════════════
// BRAIN SEARCH
// ═══════════════════════════════════════════════════════════════════════════

function normalizeObs(obs) {
  if (typeof obs === 'string') return obs;
  if (typeof obs === 'object' && obs !== null && 'content' in obs) return obs.content;
  return String(obs);
}

function searchBrain(keywords, projectScope) {
  if (!fs.existsSync(BRAIN_PATH)) return [];

  let lines;
  try {
    lines = fs.readFileSync(BRAIN_PATH, 'utf-8').trim().split('\n');
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
      // Apply project scope scoring
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

  // Sort by score desc, take top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, MAX_RESULTS);
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMAT OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

function formatResults(results, keywords, projectScope) {
  if (results.length === 0) return null;

  const scopeLabel = projectScope.length > 0 ? projectScope[0] : 'global';
  const lines = [
    `## KG Memory Recall (auto${scopeLabel !== 'global' ? ', scope: ' + scopeLabel : ''})`,
    `Keywords: ${keywords.join(', ')}`,
    `Found ${results.length} relevant entities in Knowledge Graph:`,
    ``
  ];

  for (const r of results) {
    lines.push(`### ${r.name} (${r.entityType})`);
    const obsToShow = r.observations.slice(0, MAX_OBS_PER_ENTITY);
    for (const obs of obsToShow) {
      lines.push(`- ${obs}`);
    }
    if (r.observations.length > MAX_OBS_PER_ENTITY) {
      lines.push(`- ... +${r.observations.length - MAX_OBS_PER_ENTITY} more (use open_nodes("${r.name}") for full details)`);
    }
    lines.push(``);
  }

  lines.push(`> Use open_nodes() for full entity details. Use search_nodes() for broader search.`);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    const prompt = payload.prompt || '';

    // Skip very short prompts (greetings, "yes", "ok", etc.)
    if (prompt.length < 10) process.exit(0);

    const keywords = extractKeywords(prompt);
    if (keywords.length === 0) process.exit(0);

    const projectScope = detectProjectScope();
    const results = searchBrain(keywords, projectScope);
    const output = formatResults(results, keywords, projectScope);

    if (output) {
      console.log(output);
    }

    process.exit(0);
  } catch (error) {
    // Non-blocking — never fail the user's prompt
    process.exit(0);
  }
}

main();
