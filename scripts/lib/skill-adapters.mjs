/**
 * skill-adapters.mjs — Agent config objects + transform functions.
 *
 * Defines how each AI agent stores skills (paths, formats, write strategies).
 * Pure data module — no fs operations, no side effects.
 *
 * Agents: Claude Code, Cursor, Gemini CLI, Codex
 * Strategies: per-file-copy, per-file-wrap, merge-single
 */

import { join } from 'path';

const HOME = process.env.USERPROFILE || process.env.HOME || '';

// ── Frontmatter parser (simple, no YAML lib) ──────────────────────────

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Returns { fm: {key: value} | null, body: string }.
 */
export function parseFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { fm: null, body: content };
  }
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return { fm: null, body: content };

  const fmBlock = content.slice(4, endIdx);
  const fm = {};
  for (const line of fmBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    fm[key] = val;
  }

  // Body starts after closing --- and newline
  const bodyStart = content.indexOf('\n', endIdx + 4);
  const body = bodyStart === -1 ? '' : content.slice(bodyStart + 1);
  return { fm, body };
}

// ── Transform functions ────────────────────────────────────────────────

/** Cursor MDC format: YAML frontmatter + markdown body */
function mdcWrap(body, meta) {
  const desc = meta.description || meta.name || 'Hermit skill';
  const safeDesc = desc.replace(/"/g, '\\"');
  return `---\ndescription: "${safeDesc}"\nalwaysApply: true\n---\n${body}`;
}

/** Merge-single section wrap with named markers for idempotent replace */
function sectionWrap(body, meta) {
  const n = meta.name;
  return `<!-- hermit:skill:${n} start -->\n## ${n}\n\n${body.trimEnd()}\n\n<!-- hermit:skill:${n} end -->`;
}

// ── Agent definitions ──────────────────────────────────────────────────

export const AGENTS = {
  claude: {
    skillPath: (name, root) => join(root, '.claude', 'skills', name, 'SKILL.md'),
    globalSkillPath: (name) => join(HOME, '.claude', 'skills', name, 'SKILL.md'),
    strategy: 'per-file',
    transform: (content, _meta) => content,
    mcpCapable: true,
  },
  cursor: {
    skillPath: (name, root) => join(root, '.cursor', 'rules', `hermit-${name}.mdc`),
    globalSkillPath: (name) => join(HOME, '.cursor', 'rules', `hermit-${name}.mdc`),
    strategy: 'per-file',
    transform: (content, meta) => mdcWrap(content, meta),
    mcpCapable: true,
  },
  gemini: {
    skillPath: (_name, root) => join(root, 'GEMINI.md'),
    globalSkillPath: () => join(HOME, '.gemini', 'GEMINI.md'),
    strategy: 'merge-single',
    transform: (content, meta) => sectionWrap(content, meta),
    mcpCapable: true,
  },
  codex: {
    skillPath: (_name, root) => join(root, 'AGENTS.md'),
    globalSkillPath: () => join(HOME, '.codex', 'AGENTS.md'),
    strategy: 'merge-single',
    transform: (content, meta) => sectionWrap(content, meta),
    mcpCapable: true,
  },
};
