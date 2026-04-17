/**
 * skill-adapters.mjs — Agent config objects + transform functions.
 *
 * Defines how each AI agent stores skills, commands, and hooks
 * (paths, formats, write strategies).
 * Pure data module — no fs operations, no side effects.
 *
 * Agents: Claude Code, Cursor, Cline, Gemini CLI, Codex, OpenCode, Windsurf
 * Strategies: per-file-copy, per-file-wrap, merge-single
 *
 * Claude-reference stripping (via md-strip.mjs) is applied automatically
 * for all non-Claude agents during transform. Each agent gets appropriate
 * options based on its capabilities (subagent support, hook support, etc.).
 */

import { join } from 'path';
import { stripClaudeRefs } from './md-strip.mjs';

const HOME = process.env.USERPROFILE || process.env.HOME || '';

// ── Frontmatter parser (simple, no YAML lib) ──────────────────────────

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Returns { fm: {key: value|string[]} | null, body: string }.
 *
 * Supports:
 * - Flat key: value pairs → string
 * - YAML lists (key:\n  - item1\n  - item2) → string[]
 * - Quoted values stripped of surrounding quotes
 * No YAML library — intentionally minimal.
 */
export function parseFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { fm: null, body: content };
  }
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return { fm: null, body: content };

  const fmBlock = content.slice(4, endIdx);
  const fm = {};
  const lines = fmBlock.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();

    // Check if next lines form a YAML list
    if (val === '' && i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) {
      const items = [];
      i++;
      while (i < lines.length && /^\s+-\s/.test(lines[i])) {
        let item = lines[i].replace(/^\s+-\s*/, '').trim();
        // Strip surrounding quotes
        if ((item.startsWith('"') && item.endsWith('"')) || (item.startsWith("'") && item.endsWith("'"))) {
          item = item.slice(1, -1);
        }
        items.push(item);
        i++;
      }
      fm[key] = items;
    } else {
      fm[key] = val;
      i++;
    }
  }

  // Body starts after closing --- and newline
  const bodyStart = content.indexOf('\n', endIdx + 4);
  const body = bodyStart === -1 ? '' : content.slice(bodyStart + 1);
  return { fm, body };
}

// ── Per-agent strip options ──────────────────────────────────────────────
// Controls what gets stripped when exporting to each non-Claude agent.

const STRIP_OPTS = {
  cursor:   { agent: 'cursor',   preserveDelegation: true,  preserveHooks: true  },
  cline:    { agent: 'cline',    preserveDelegation: true,  preserveHooks: true  },
  gemini:   { agent: 'gemini',   preserveDelegation: false, preserveHooks: false },
  codex:    { agent: 'codex',    preserveDelegation: false, preserveHooks: false },
  opencode:  { agent: 'opencode',  preserveDelegation: true,  preserveHooks: true  },
  windsurf:  { agent: 'windsurf',  preserveDelegation: false, preserveHooks: false },
};

// ── Transform functions ────────────────────────────────────────────────

/**
 * Strip Claude refs then apply format wrapper.
 * @param {string} body - Raw markdown body
 * @param {object} meta - { name, description }
 * @param {string} agent - Agent key (cursor/cline/gemini/codex)
 * @param {(body: string, meta: object) => string} formatter - Format wrapper function
 * @returns {string}
 */
function stripAndFormat(body, meta, agent, formatter) {
  const opts = STRIP_OPTS[agent] || { agent };
  const { content } = stripClaudeRefs(body, opts);
  return formatter(content, meta);
}

/** Cursor MDC format: YAML frontmatter + markdown body (used for commands) */
function mdcWrap(body, meta) {
  const desc = meta.description || meta.name || 'Hermit skill';
  const safeDesc = desc.replace(/"/g, '\\"');
  return `---\ndescription: "${safeDesc}"\nalwaysApply: true\n---\n${body}`;
}

/** Cursor skill format: plain markdown (for .cursor/skills/) — no frontmatter per Cursor docs */
function cursorSkillWrap(body, _meta) {
  return body;
}

/** Merge-single section wrap with named markers for idempotent replace */
function sectionWrap(body, meta) {
  const n = meta.name;
  return `<!-- hermit:skill:${n} start -->\n## ${n}\n\n${body.trimEnd()}\n\n<!-- hermit:skill:${n} end -->`;
}

/** Command section wrap — distinct markers from skills */
function commandSectionWrap(body, meta) {
  const n = meta.name;
  return `<!-- hermit:cmd:${n} start -->\n## /${n}\n\n${body.trimEnd()}\n\n<!-- hermit:cmd:${n} end -->`;
}

// ── Unified agent definitions ────────────────────────────────────────

export const AGENTS = {
  claude: {
    mcpCapable: true,
    skills: {
      path: (name, root) => join(root, '.claude', 'skills', name, 'SKILL.md'),
      globalPath: (name) => join(HOME, '.claude', 'skills', name, 'SKILL.md'),
      strategy: 'per-file',
      transform: (content, _meta) => content,
    },
    commands: {
      path: (name, root) => join(root, '.claude', 'commands', `${name}.md`),
      globalPath: (name) => join(HOME, '.claude', 'commands', `${name}.md`),
      strategy: 'per-file',
      transform: (content, _meta) => content,
    },
    hooks: {
      path: (filename, root) => join(root, '.claude', 'hooks', filename),
      globalPath: (filename) => join(HOME, '.claude', 'hooks', filename),
      libPath: (root) => join(root, '.claude', 'hooks', 'lib'),
      globalLibPath: () => join(HOME, '.claude', 'hooks', 'lib'),
    },
  },

  cursor: {
    mcpCapable: true,
    skills: {
      path: (name, root) => join(root, '.cursor', 'skills', name, 'SKILL.md'),
      // Cursor beta only reads skills from global ~/.claude/skills/, not .cursor/skills/
      globalPath: (name) => join(HOME, '.claude', 'skills', name, 'SKILL.md'),
      strategy: 'per-file',
      transform: (content, meta) => stripAndFormat(content, meta, 'cursor', cursorSkillWrap),
    },
    commands: {
      path: (name, root) => join(root, '.cursor', 'rules', `hermit-cmd-${name}.mdc`),
      globalPath: (name) => join(HOME, '.cursor', 'rules', `hermit-cmd-${name}.mdc`),
      strategy: 'per-file',
      transform: (content, meta) => stripAndFormat(content, meta, 'cursor', mdcWrap),
    },
    hooks: {
      path: (filename, root) => join(root, '.cursor', 'hooks', filename),
      globalPath: (filename) => join(HOME, '.cursor', 'hooks', filename),
      libPath: (root) => join(root, '.cursor', 'hooks', 'lib'),
      globalLibPath: () => join(HOME, '.cursor', 'hooks', 'lib'),
    },
    mcp: {
      globalPath: () => join(HOME, '.cursor', 'mcp.json'),
      projectPath: (root) => join(root, '.cursor', 'mcp.json'),
    },
  },

  gemini: {
    mcpCapable: true,
    skills: {
      path: (_name, root) => join(root, 'GEMINI.md'),
      globalPath: () => join(HOME, '.gemini', 'GEMINI.md'),
      strategy: 'merge-single',
      transform: (content, meta) => stripAndFormat(content, meta, 'gemini', sectionWrap),
    },
    commands: {
      path: (_name, root) => join(root, 'GEMINI.md'),
      globalPath: () => join(HOME, '.gemini', 'GEMINI.md'),
      strategy: 'merge-single',
      transform: (content, meta) => stripAndFormat(content, meta, 'gemini', commandSectionWrap),
    },
    hooks: {
      path: (filename, root) => join(root, '.gemini', 'hooks', filename),
      globalPath: (filename) => join(HOME, '.gemini', 'hooks', filename),
      libPath: (root) => join(root, '.gemini', 'hooks', 'lib'),
      globalLibPath: () => join(HOME, '.gemini', 'hooks', 'lib'),
    },
    mcp: {
      antigravityConfig: () => join(HOME, '.gemini', 'antigravity', 'mcp_config.json'),
      settingsPath: () => join(HOME, '.gemini', 'settings.json'),
    },
  },

  cline: {
    mcpCapable: true,
    skills: {
      path: (name, root) => join(root, '.clinerules', `hermit-${name}.md`),
      globalPath: (name) => join(HOME, '.cline', 'rules', `hermit-${name}.md`),
      strategy: 'per-file',
      transform: (content, meta) => stripAndFormat(content, meta, 'cline', (body) => body),
    },
    commands: {
      path: (name, root) => join(root, '.clinerules', `hermit-cmd-${name}.md`),
      globalPath: (name) => join(HOME, '.cline', 'rules', `hermit-cmd-${name}.md`),
      strategy: 'per-file',
      transform: (content, meta) => stripAndFormat(content, meta, 'cline', (body) => body),
    },
    hooks: {
      path: (filename, root) => join(root, '.cline', 'hooks', filename),
      globalPath: (filename) => join(HOME, '.cline', 'hooks', filename),
      libPath: (root) => join(root, '.cline', 'hooks', 'lib'),
      globalLibPath: () => join(HOME, '.cline', 'hooks', 'lib'),
    },
  },

  codex: {
    mcpCapable: true,
    skills: {
      path: (_name, root) => join(root, 'AGENTS.md'),
      globalPath: () => join(HOME, '.codex', 'AGENTS.md'),
      strategy: 'merge-single',
      transform: (content, meta) => stripAndFormat(content, meta, 'codex', sectionWrap),
    },
    commands: {
      path: (_name, root) => join(root, 'AGENTS.md'),
      globalPath: () => join(HOME, '.codex', 'AGENTS.md'),
      strategy: 'merge-single',
      transform: (content, meta) => stripAndFormat(content, meta, 'codex', commandSectionWrap),
    },
    hooks: {
      path: (filename, root) => join(root, '.codex', 'hooks', filename),
      globalPath: (filename) => join(HOME, '.codex', 'hooks', filename),
      libPath: (root) => join(root, '.codex', 'hooks', 'lib'),
      globalLibPath: () => join(HOME, '.codex', 'hooks', 'lib'),
    },
  },

  opencode: {
    mcpCapable: true,
    skills: {
      path: (name, root) => join(root, '.opencode', 'skills', name, 'SKILL.md'),
      globalPath: (name) => join(HOME, '.opencode', 'skills', name, 'SKILL.md'),
      strategy: 'per-file',
      transform: (content, meta) => stripAndFormat(content, meta, 'opencode', (body) => body),
    },
    commands: {
      path: (_name, root) => join(root, 'AGENTS.md'),
      globalPath: () => join(HOME, '.opencode', 'AGENTS.md'),
      strategy: 'merge-single',
      transform: (content, meta) => stripAndFormat(content, meta, 'opencode', commandSectionWrap),
    },
    hooks: {
      path: (filename, root) => join(root, '.opencode', 'hooks', filename),
      globalPath: (filename) => join(HOME, '.opencode', 'hooks', filename),
      libPath: (root) => join(root, '.opencode', 'hooks', 'lib'),
      globalLibPath: () => join(HOME, '.opencode', 'hooks', 'lib'),
    },
  },

  windsurf: {
    mcpCapable: true,
    skills: {
      path: (_name, root) => join(root, '.windsurfrules'),
      globalPath: () => join(HOME, '.codeium', 'windsurf', 'memories', 'global_rules.md'),
      strategy: 'merge-single',
      transform: (content, meta) => stripAndFormat(content, meta, 'windsurf', sectionWrap),
    },
    commands: {
      path: (_name, root) => join(root, '.windsurfrules'),
      globalPath: () => join(HOME, '.codeium', 'windsurf', 'memories', 'global_rules.md'),
      strategy: 'merge-single',
      transform: (content, meta) => stripAndFormat(content, meta, 'windsurf', commandSectionWrap),
    },
    hooks: null, // Windsurf does not support hooks
  },
};
