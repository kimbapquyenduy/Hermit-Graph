/**
 * skill-search-module.mjs — MCP tool: hermit_skill_search.
 *
 * Finds relevant skills by keyword-matching user query against skill metadata.
 * Weighted scoring: name 5x, tags 3x, description 1x.
 * Returns ranked matches with activation hints.
 *
 * Consumes skill-index.mjs (P0) for the unified metadata index.
 */

import { z } from 'zod';
import { getSkillIndex } from './skill-index.mjs';

const RO = { readOnlyHint: true };

// ── Keyword scoring ─────────────────────────────────────────────────

/** Normalize query into lowercase terms, strip noise words. */
const NOISE = new Set(['help', 'me', 'please', 'want', 'need', 'how', 'to', 'do', 'i', 'a', 'the']);

function tokenize(text) {
  return text.toLowerCase().split(/[\s\-_:;,.!?()[\]{}"'`/\\|<>@#$%^&*+=~]+/)
    .filter(t => t.length > 1 && !NOISE.has(t));
}

/**
 * Score a single skill against query terms.
 * Weights: name match 5, tag match 3, description match 1.
 * Normalized to [0, 1] range.
 *
 * @param {string[]} queryTerms - Tokenized query
 * @param {import('./skill-index.mjs').SkillMeta} skill
 * @returns {number}
 */
function scoreSkill(queryTerms, skill) {
  if (queryTerms.length === 0) return 0;

  const nameLower = skill.name.toLowerCase().replace(/-/g, ' ');
  const tagsLower = skill.tags.join(' ').toLowerCase();
  const descLower = skill.description.toLowerCase();

  let totalScore = 0;
  const maxPossible = queryTerms.length * 5; // best case: all terms match name

  for (const term of queryTerms) {
    if (nameLower.includes(term)) {
      totalScore += 5;
    } else if (tagsLower.includes(term)) {
      totalScore += 3;
    } else if (descLower.includes(term)) {
      totalScore += 1;
    }
  }

  return maxPossible > 0 ? totalScore / maxPossible : 0;
}

// ── Search function ─────────────────────────────────────────────────

/**
 * Search skills by query. Returns ranked matches.
 * @param {string} query - Natural language query
 * @param {{ limit?: number, source?: string, minScore?: number }} options
 * @returns {Array<{ name, description, tags, score, source, complexity, activationHint }>}
 */
export function searchSkills(query, options = {}) {
  const { limit = 5, source = 'all', minScore = 0.1 } = options;
  const index = getSkillIndex();
  const queryTerms = tokenize(query);

  if (queryTerms.length === 0) return [];

  const results = [];

  for (const [, skill] of index) {
    // Filter by source
    if (source !== 'all' && skill.source !== source) continue;

    const score = scoreSkill(queryTerms, skill);
    if (score >= minScore) {
      results.push({
        name: skill.name,
        description: skill.description.slice(0, 120),
        tags: skill.tags.slice(0, 5),
        score: Math.round(score * 100) / 100,
        source: skill.source,
        complexity: skill.complexity || 'unknown',
        activationHint: skill.source === 'project'
          ? `Read .claude/skills/${skill.name}/SKILL.md`
          : `Read catalog/skills/${skill.name}/SKILL.md`,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ── MCP tool registration ───────────────────────────────────────────

export function register(server, ctx) {
  const { log } = ctx;

  server.tool(
    'hermit_skill_search',
    'Search hermit skills by query — find relevant skills for a task',
    {
      query: z.string().min(1).max(500).describe('Search query (natural language or keywords)'),
      limit: z.number().int().min(1).max(20).optional().default(5)
        .describe('Max results to return'),
      source: z.enum(['catalog', 'project', 'all']).optional().default('all')
        .describe('Filter by skill source'),
    },
    RO,
    async ({ query, limit, source }) => {
      const matches = searchSkills(query, { limit, source });
      const index = getSkillIndex();

      const response = {
        matches,
        query,
        totalSkills: index.size,
        searchMethod: 'keyword',
      };

      if (matches.length === 0) {
        return {
          content: [{ type: 'text', text: `No skills found for "${query}" (searched ${index.size} skills).` }],
        };
      }

      const lines = [`Found ${matches.length} skills for "${query}" (searched ${index.size}):\n`];
      for (const m of matches) {
        const tags = m.tags.length ? ` [${m.tags.join(', ')}]` : '';
        lines.push(`  ${m.name} (${m.score})${tags}`);
        if (m.description) lines.push(`    ${m.description}`);
        lines.push(`    → ${m.activationHint}`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  log('skill-search-module: 1 tool registered (hermit_skill_search)');
}
