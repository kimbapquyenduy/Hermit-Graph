/**
 * md-strip.mjs — Strip Claude Code-specific references from markdown content.
 *
 * Claude-reference stripping for cross-agent skill export.
 * Used when exporting skills/commands to non-Claude agents (Gemini, Codex, Cline, Cursor).
 *
 * Features:
 * - Tool name replacement (Read tool → file reading, etc.)
 * - Slash command removal (preserves URLs + real file paths)
 * - .claude/ directory path rewriting
 * - Agent delegation pattern removal (configurable)
 * - Hook/SendMessage/TaskCreate section removal
 * - Code block preservation (never modifies inside ```)
 * - Char limit truncation at clean section/paragraph boundaries
 * - Consecutive blank line cleanup
 */

/** Max content size for regex processing (500KB safety guard) */
const MAX_CONTENT_SIZE = 512_000;

// ── Code block detection ────────────────────────────────────────────────

/**
 * Build a fast position-in-code-block checker from content.
 * Pre-computes all code block ranges for O(n) check via closure.
 * @param {string} content
 * @returns {(pos: number) => boolean}
 */
function buildCodeBlockChecker(content) {
  const ranges = [];
  const regex = /```[\s\S]*?```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return (pos) => ranges.some(([s, e]) => pos >= s && pos < e);
}

// ── Tool name replacements ──────────────────────────────────────────────

const TOOL_REPLACEMENTS = [
  [/\b(the\s+)?Read\s+tool\b/gi, 'file reading'],
  [/\buse\s+Read\b/gi, 'use file reading'],
  [/\b(the\s+)?Write\s+tool\b/gi, 'file writing'],
  [/\buse\s+Write\b/gi, 'use file writing'],
  [/\b(the\s+)?Edit\s+tool\b/gi, 'file editing'],
  [/\buse\s+Edit\b/gi, 'use file editing'],
  [/\b(the\s+)?Bash\s+tool\b/gi, 'terminal/shell'],
  [/\buse\s+Bash\b/gi, 'use terminal/shell'],
  [/\b(the\s+)?Grep\s+tool\b/gi, 'code search'],
  [/\buse\s+Grep\b/gi, 'use code search'],
  [/\b(the\s+)?Glob\s+tool\b/gi, 'file search'],
  [/\buse\s+Glob\b/gi, 'use file search'],
  [/\b(the\s+)?Task\s+tool\b/gi, 'subtask delegation'],
  [/\buse\s+Task\b/gi, 'use subtask delegation'],
  [/\bWebFetch\b/g, 'web access'],
  [/\bWebSearch\b/g, 'web access'],
  [/\bNotebookEdit\b/g, 'notebook editing'],
  [/\bAskUserQuestion\b/g, 'ask the user'],
  [/\bTodoWrite\b/g, 'task tracking'],
  [/\bEnterPlanMode\b/g, 'planning mode'],
  [/\bExitPlanMode\b/g, 'exit planning'],
];

// ── Slash command removal ───────────────────────────────────────────────

/** Paths that look like real filesystem paths, not slash commands */
const REAL_PATH_PREFIXES = [
  '/api/', '/src/', '/home/', '/Users/', '/var/', '/etc/', '/opt/', '/tmp/',
  '/bin/', '/usr/', '/lib/', '/dev/', '/mnt/', '/proc/',
];

/**
 * Remove slash commands while preserving URLs and real file paths.
 * @param {string} content
 * @param {(pos: number) => boolean} isInCodeBlock
 * @returns {string}
 */
function removeSlashCommands(content, isInCodeBlock) {
  return content.replace(/(?<!\w)(\/[a-z][a-z0-9/._:-]+)/g, (matched, _p1, offset) => {
    if (isInCodeBlock(offset)) return matched;

    // Strip trailing punctuation for analysis
    const trailingMatch = matched.match(/[.,!?;:]$/);
    const trailing = trailingMatch?.[0] ?? '';
    const normalized = trailing ? matched.slice(0, -trailing.length) : matched;

    // Preserve URLs (preceded by http:// or https://)
    const before = content.slice(Math.max(0, offset - 10), offset);
    if (/https?:\/\/$/.test(before)) return matched;

    // Preserve real filesystem paths
    if (REAL_PATH_PREFIXES.some(p => normalized.startsWith(p))) return matched;

    // Preserve paths with file extensions (e.g. /path/to/file.ts)
    if (/\.\w+$/.test(normalized)) return matched;

    // Preserve paths with 3+ segments (likely a real path)
    if ((normalized.match(/\//g) || []).length >= 3) return matched;

    // Remove the slash command, keep trailing punctuation
    return trailing;
  });
}

// ── .claude/ path rewriting ─────────────────────────────────────────────

/**
 * Rewrite .claude/{dir}/ references to generic descriptions.
 * @param {string} content
 * @param {string} sourceDir - e.g. 'skills', 'rules', 'commands', 'hooks'
 * @param {string} fallback - e.g. 'project skills directory/'
 * @param {(pos: number) => boolean} isInCodeBlock
 * @returns {string}
 */
function rewriteClaudeDirRefs(content, sourceDir, fallback, isInCodeBlock) {
  // Replace .claude/{dir}/{item} paths
  const withItems = new RegExp(`\\.claude\\/${sourceDir}\\/([a-zA-Z0-9_./-]+)`, 'gi');
  let result = content.replace(withItems, (matched, suffix, offset) => {
    if (isInCodeBlock(offset)) return matched;
    return `${fallback}${suffix}`;
  });

  // Replace bare .claude/{dir}/ references
  const bareDir = new RegExp(`\\.claude\\/${sourceDir}\\/`, 'gi');
  result = result.replace(bareDir, (matched, offset) => {
    if (isInCodeBlock(offset)) return matched;
    return fallback;
  });

  return result;
}

// ── Delegation pattern removal ──────────────────────────────────────────

const DELEGATION_PATTERNS = [
  /^.*\bdelegate\s+to\s+`[^`]+`\s+agent.*$/gim,
  /^.*\bspawn.*agent.*$/gim,
  /^.*\buse.*subagent.*$/gim,
];

// ── Section removal ─────────────────────────────────────────────────────

/**
 * Remove sections by heading title match. Removes heading + all content until next same-or-higher-level heading.
 * @param {string} content
 * @param {Array<RegExp>} titlePatterns - Patterns to match heading titles
 * @param {Array<RegExp>} [linePatterns] - Patterns to remove individual lines
 * @returns {{ content: string, removedSections: string[] }}
 */
function removeSections(content, titlePatterns, linePatterns = []) {
  const lines = content.split('\n');
  const filtered = [];
  const removedSections = [];
  let skipUntilHeading = false;
  let skipLevel = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2];

      // Check if this heading should be removed
      if (titlePatterns.some(p => p.test(title))) {
        skipUntilHeading = true;
        skipLevel = level;
        removedSections.push(title.trim());
        continue;
      }

      // End skip if we hit a same-or-higher-level heading
      if (skipUntilHeading && level <= skipLevel) {
        skipUntilHeading = false;
      }
    }

    if (skipUntilHeading) continue;

    // Check line-level patterns
    if (linePatterns.some(p => p.test(line))) continue;

    filtered.push(line);
  }

  return { content: filtered.join('\n'), removedSections };
}

// ── Truncation ──────────────────────────────────────────────────────────

/**
 * Truncate markdown at clean section/paragraph boundaries.
 * Removes sections from bottom up until content fits within limit.
 * @param {string} content
 * @param {number} limit
 * @returns {{ result: string, originalLength: number, removedSections: string[] }}
 */
export function truncateAtCleanBoundary(content, limit) {
  const originalLength = content.length;
  if (limit <= 0) return { result: '', originalLength, removedSections: [] };
  if (content.length <= limit) return { result: content, originalLength, removedSections: [] };

  // Find section boundaries
  const sectionRegex = /^(#{2,3})\s+(.+)$/gm;
  const sectionStarts = [];
  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    sectionStarts.push({ index: match.index, title: match[2].trim() });
  }

  // No sections — truncate at paragraph boundary
  if (sectionStarts.length === 0) {
    return truncateAtParagraph(content, limit, originalLength);
  }

  // Build section ranges
  const sections = sectionStarts.map((s, i) => ({
    title: s.title,
    start: s.index,
    end: i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : content.length,
  }));

  const preamble = content.slice(0, sections[0]?.start ?? content.length);
  const removedSections = [];
  const kept = [...sections];

  // Remove sections from bottom up until under limit
  while (kept.length > 0) {
    const candidate = preamble + kept.map(s => content.slice(s.start, s.end)).join('');
    if (candidate.trim().length <= limit) {
      return { result: candidate.trim(), originalLength, removedSections };
    }
    const removed = kept.pop();
    if (removed) removedSections.push(removed.title);
  }

  // Even preamble exceeds limit
  if (preamble.trim().length > limit) {
    return truncateAtParagraph(preamble, limit, originalLength);
  }

  return { result: preamble.trim(), originalLength, removedSections };
}

function truncateAtParagraph(content, limit, originalLength) {
  const truncated = content.slice(0, limit);

  // Try paragraph break (double newline)
  const lastParagraph = truncated.lastIndexOf('\n\n');
  if (lastParagraph >= limit * 0.5) {
    return { result: truncated.slice(0, lastParagraph).trimEnd(), originalLength, removedSections: [] };
  }

  // Try single newline
  const lastNewline = truncated.lastIndexOf('\n');
  if (lastNewline >= limit * 0.3) {
    return { result: truncated.slice(0, lastNewline).trimEnd(), originalLength, removedSections: [] };
  }

  // Hard truncate
  return { result: truncated.trimEnd(), originalLength, removedSections: [] };
}

// ── Main export ─────────────────────────────────────────────────────────

/**
 * Strip Claude Code-specific references from markdown content.
 *
 * @param {string} content - Raw markdown content
 * @param {object} [options]
 * @param {string} [options.agent] - Target agent name (for context-aware stripping)
 * @param {number} [options.charLimit] - Max output chars (truncates at clean boundaries)
 * @param {boolean} [options.preserveDelegation=false] - Keep delegation patterns (for agents with subagent support)
 * @param {boolean} [options.preserveHooks=false] - Keep hook sections
 * @returns {{ content: string, warnings: string[], removedSections: string[] }}
 */
export function stripClaudeRefs(content, options = {}) {
  const warnings = [];
  let removedSections = [];

  // Safety guard for huge content
  if (content.length > MAX_CONTENT_SIZE) {
    warnings.push(`Content exceeds ${MAX_CONTENT_SIZE} chars; stripping skipped`);
    return { content, warnings, removedSections: [] };
  }

  const isInCodeBlock = buildCodeBlockChecker(content);
  let result = content;

  // 1. Replace Claude tool name references (skip code blocks)
  for (const [regex, replacement] of TOOL_REPLACEMENTS) {
    result = result.replace(regex, (matched, ...args) => {
      const offset = args[args.length - 2];
      return isInCodeBlock(offset) ? matched : replacement;
    });
  }

  // 2. Remove slash commands (preserve URLs + real paths)
  result = removeSlashCommands(result, isInCodeBlock);

  // 3. Rewrite .claude/ directory references
  result = rewriteClaudeDirRefs(result, 'skills', 'project skills directory/', isInCodeBlock);
  result = rewriteClaudeDirRefs(result, 'rules', 'project rules directory/', isInCodeBlock);
  result = rewriteClaudeDirRefs(result, 'commands', 'project commands directory/', isInCodeBlock);
  result = rewriteClaudeDirRefs(result, 'agents', 'project agents directory/', isInCodeBlock);
  result = rewriteClaudeDirRefs(result, 'hooks', 'project hooks directory/', isInCodeBlock);

  // Replace CLAUDE.md references
  result = result.replace(/\bCLAUDE\.md\b/g, (matched, offset) => {
    return isInCodeBlock(offset) ? matched : 'project configuration file';
  });

  // 4. Remove agent delegation patterns (unless preserved)
  if (!options.preserveDelegation) {
    for (const pattern of DELEGATION_PATTERNS) {
      result = result.replace(pattern, '');
    }
  }

  // 5. Remove Hook/SendMessage/TaskCreate sections + lines
  const sectionTitlePatterns = [
    /SendMessage|TaskCreate|TaskUpdate/i,
  ];
  if (!options.preserveHooks) {
    sectionTitlePatterns.push(/hook/i);
  }
  // Agent Team sections — only remove when delegation not preserved
  if (!options.preserveDelegation) {
    sectionTitlePatterns.push(/agent\s+team/i);
  }

  const linePatterns = [
    /SendMessage|TaskCreate|TaskUpdate/,
  ];

  const sectionResult = removeSections(result, sectionTitlePatterns, linePatterns);
  result = sectionResult.content;
  removedSections = sectionResult.removedSections;

  // 6. Cleanup
  result = result.replace(/\n{3,}/g, '\n\n');               // max 2 consecutive blank lines
  result = result.split('\n').map(l => l.trimEnd()).join('\n'); // trailing whitespace
  result = result.trim();

  // 7. Char limit truncation
  if (options.charLimit && result.length > options.charLimit) {
    const truncated = truncateAtCleanBoundary(result, options.charLimit);
    result = truncated.result;
    const overBy = truncated.originalLength - options.charLimit;
    const pct = Math.round((overBy / options.charLimit) * 100);
    let msg = `Truncated from ${truncated.originalLength} to ${result.length} chars (${pct}% over ${options.charLimit} limit)`;
    if (truncated.removedSections.length > 0) {
      msg += `; removed: ${truncated.removedSections.join(', ')}`;
    }
    if (options.agent) msg += ` [${options.agent}]`;
    warnings.push(msg);
  }

  // 8. Check empty result
  if (!result || result.length === 0) {
    const tag = options.agent ? ` [${options.agent}]` : '';
    warnings.push(`All content was Claude-specific${tag}`);
  }

  return { content: result, warnings, removedSections };
}
