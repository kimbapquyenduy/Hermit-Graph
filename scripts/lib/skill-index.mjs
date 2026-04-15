/**
 * skill-index.mjs — Unified skill metadata index for discovery + search.
 *
 * Builds a cached Map<name, SkillMeta> from catalog + project skills.
 * Consumed by: skill-search-module.mjs (P1), future paths: activation (P3).
 *
 * Lazy singleton — built on first access, cached for process lifetime.
 * Call invalidateSkillIndex() to force rebuild (hot-reload scenarios).
 */

import { discoverSkills } from './skill-export.mjs';
import { discoverProjectSkills } from './project-skill-export.mjs';
import { parseFrontmatter } from './skill-adapters.mjs';

// ── Description extraction ──────────────────────────────────────────

/**
 * Extract a description from skill body text when no frontmatter description.
 * Looks for first heading text + first non-empty paragraph (max 200 chars).
 * @param {string} body - Markdown body (after frontmatter)
 * @returns {string}
 */
function extractDescription(body) {
  if (!body) return '';
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);

  // Skip heading markers, take first meaningful text
  for (const line of lines) {
    const text = line.replace(/^#+\s*/, '').trim();
    if (text.length >= 10 && !text.startsWith('```') && !text.startsWith('|')) {
      return text.slice(0, 200);
    }
  }
  return lines[0]?.slice(0, 200) || '';
}

// ── Tag extraction ──────────────────────────────────────────────────

const TAG_STOPWORDS = new Set(['skill', 'the', 'and', 'for', 'with', 'pro', 'max']);

/**
 * Extract tags from frontmatter or generate from skill name.
 * @param {string} name - Skill directory name (kebab-case)
 * @param {object|null} fm - Parsed frontmatter
 * @returns {string[]}
 */
function extractTags(name, fm) {
  // Prefer frontmatter tags (comma-separated string)
  if (fm?.tags) {
    return fm.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  }
  // Generate from name parts
  return name.split('-').filter(p => p.length > 2 && !TAG_STOPWORDS.has(p));
}

// ── Paths extraction ────────────────────────────────────────────────

/**
 * Parse paths: frontmatter into array of gitignore-style patterns.
 * Supports comma-separated or space-separated patterns.
 * @param {object|null} fm - Parsed frontmatter
 * @returns {string[]}
 */
function parsePaths(fm) {
  if (!fm?.paths) return [];
  return fm.paths.split(/[,\s]+/).map(p => p.trim()).filter(Boolean);
}

// ── Index builder ───────────────────────────────────────────────────

/**
 * @typedef {Object} SkillMeta
 * @property {string} name - Directory name (kebab-case)
 * @property {string} description - From frontmatter or extracted from body
 * @property {string[]} tags - From frontmatter or generated from name
 * @property {string[]} paths - Gitignore patterns for conditional activation
 * @property {'catalog'|'project'} source
 * @property {string} complexity - simple/moderate/complex (from frontmatter)
 * @property {string} filePath - Relative hint (not absolute, for display)
 */

/**
 * Build unified skill index from catalog + project skills.
 * @param {string} [catalogRoot] - Override catalog root
 * @param {string} [projectRoot] - Override project root
 * @returns {Map<string, SkillMeta>}
 */
export function buildSkillIndex(catalogRoot, projectRoot) {
  const index = new Map();

  // Catalog skills
  const catalogSkills = discoverSkills(catalogRoot);
  for (const skill of catalogSkills) {
    index.set(skill.name, {
      name: skill.name,
      description: skill.fm?.description || extractDescription(skill.body),
      tags: extractTags(skill.name, skill.fm),
      paths: parsePaths(skill.fm),
      source: 'catalog',
      complexity: skill.fm?.complexity || '',
      filePath: `catalog/skills/${skill.name}/SKILL.md`,
    });
  }

  // Project skills (override catalog on name collision)
  try {
    const projectSkills = discoverProjectSkills(projectRoot);
    for (const skill of projectSkills) {
      index.set(skill.name, {
        name: skill.name,
        description: skill.fm?.description || extractDescription(skill.body),
        tags: extractTags(skill.name, skill.fm),
        paths: parsePaths(skill.fm),
        source: 'project',
        complexity: skill.fm?.complexity || '',
        filePath: `.claude/skills/${skill.name}/SKILL.md`,
      });
    }
  } catch (err) {
    // Only silence "directory not found" — log real errors
    if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
      process.stderr.write(`[hermit] skill-index: project skills error: ${err.message}\n`);
    }
  }

  return index;
}

// ── Lazy singleton ──────────────────────────────────────────────────

let _cache = null;

/**
 * Get skill index (lazy — builds on first call, caches for process lifetime).
 * @returns {Map<string, SkillMeta>}
 */
export function getSkillIndex() {
  if (!_cache) _cache = buildSkillIndex();
  return _cache;
}

/** Clear cached index (for hot-reload or after skill changes). */
export function invalidateSkillIndex() {
  _cache = null;
}
