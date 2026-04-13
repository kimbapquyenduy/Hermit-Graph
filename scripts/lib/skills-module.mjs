/**
 * skills-module.mjs — MCP tools for skill distribution.
 *
 * Tools: hermit_skill_list (browse catalog), hermit_skill_export (export to agents).
 * Uses skill-export.mjs engine + skill-adapters.mjs agent configs.
 */

import { z } from 'zod';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { discoverSkills, exportSkill, exportAll, checkCompat } from './skill-export.mjs';
import { AGENTS } from './skill-adapters.mjs';

function ok(text) { return { content: [{ type: 'text', text }] }; }
function fail(text) { return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true }; }

const AGENT_NAMES = Object.keys(AGENTS);

export function register(server, ctx) {
  const { log } = ctx;

  // ── Tool: hermit_skill_list ────────────────────────────────────────
  server.tool(
    'hermit_skill_list',
    'List available hermit skills with per-agent compatibility.',
    { agent: z.enum(AGENT_NAMES).optional().describe('Filter by agent compatibility') },
    async ({ agent }) => {
      const skills = discoverSkills();
      if (!skills.length) return ok('No skills found in catalog/skills/.');

      const lines = [`Hermit Skills (${skills.length} available)\n`];

      for (const skill of skills) {
        const compat = AGENT_NAMES.filter(a => checkCompat(skill.fm, AGENTS[a]));
        if (agent && !compat.includes(agent)) continue;
        const compatStr = compat.join(', ');
        const note = compat.length < AGENT_NAMES.length ? '  [MCP required]' : '';
        lines.push(`  ${skill.name.padEnd(22)} Compatible: ${compatStr}${note}`);
      }

      return ok(lines.join('\n'));
    }
  );

  // ── Tool: hermit_skill_export ──────────────────────────────────────
  server.tool(
    'hermit_skill_export',
    'Export hermit skill(s) to an AI agent. Writes files to agent-specific locations.',
    {
      skillName: z.string().describe('Skill name from catalog, or "__all__" for all skills'),
      agent: z.enum([...AGENT_NAMES, 'all']).describe('Target agent (claude/cursor/gemini/codex/all)'),
      project: z.string().optional().describe('Project root path for project-mode export'),
      global: z.boolean().optional().default(false).describe('Export to agent global config dir'),
    },
    async ({ skillName, agent, project, global: isGlobal }) => {
      // Validate project path if provided
      if (project) {
        const resolved = resolve(project);
        if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
          return fail(`Project path not found or not a directory: ${project}`);
        }
      }

      // Default to global if neither specified
      const opts = { project, global: isGlobal || !project };

      const agents = agent === 'all' ? AGENT_NAMES : [agent];
      const results = [];
      const errors = [];

      for (const ag of agents) {
        try {
          if (skillName === '__all__') {
            results.push(...exportAll(ag, opts));
          } else {
            results.push(exportSkill(skillName, ag, opts));
          }
        } catch (err) {
          errors.push(`${ag}: ${err.message}`);
        }
      }

      // Format output
      const exported = results.filter(r => r.action !== 'skipped');
      const skipped = results.filter(r => r.action === 'skipped');

      const lines = [`Exported ${exported.length} skill(s):\n`];
      for (const r of exported) {
        const icon = r.action === 'created' ? '+' : '~';
        lines.push(`  ${icon} ${r.path} (${r.action}) [${r.agent}]`);
      }
      for (const r of skipped) {
        const skillLabel = r.name ? `${r.name} ` : '';
        lines.push(`  - skipped ${skillLabel}[${r.agent}]: ${r.reason || 'incompatible'}`);
      }
      for (const e of errors) {
        lines.push(`  ! error: ${e}`);
      }

      if (!exported.length && errors.length) return fail(lines.join('\n'));
      return ok(lines.join('\n'));
    }
  );

  log('skills-module: 2 tools registered');
}
