/**
 * skills-module.mjs — MCP tools for skill, command, and hook distribution.
 *
 * Tools: hermit_skill_list, hermit_skill_export, hermit_command_list,
 *        hermit_command_export, hermit_hook_list, hermit_hook_export.
 * Uses skill-export.mjs + hook-export.mjs engines + skill-adapters.mjs agent configs.
 */

import { z } from 'zod';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { discoverSkills, exportSkill, exportAll, checkCompat, discoverCommands, exportCommand, exportAllCommands } from './skill-export.mjs';
import { discoverHooks, exportHook, exportAllHooks } from './hook-export.mjs';
import { discoverProjectSkills, exportProjectSkill, exportAllProjectSkills } from './project-skill-export.mjs';
import { AGENTS } from './skill-adapters.mjs';

function ok(text) { return { content: [{ type: 'text', text }] }; }
function fail(text) { return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true }; }

const AGENT_NAMES = Object.keys(AGENTS);

/** Validate project path, return fail response or null if valid */
function validateProject(project) {
  if (!project) return null;
  const resolved = resolve(project);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    return fail(`Project path not found or not a directory: ${project}`);
  }
  return null;
}

/** Format export results into response text */
function formatExportResults(results, errors, itemType) {
  const exported = results.filter(r => r.action !== 'skipped' && r.action !== 'error');
  const skipped = results.filter(r => r.action === 'skipped');
  const errored = results.filter(r => r.action === 'error');

  const lines = [`Exported ${exported.length} ${itemType}(s):\n`];
  for (const r of exported) {
    const icon = r.action === 'created' ? '+' : '~';
    lines.push(`  ${icon} ${r.path} (${r.action}) [${r.agent}]`);
  }
  for (const r of skipped) {
    const label = r.name ? `${r.name} ` : '';
    lines.push(`  - skipped ${label}[${r.agent}]: ${r.reason || 'incompatible'}`);
  }
  for (const r of errored) {
    lines.push(`  ! error: ${r.name} [${r.agent}]: ${r.reason}`);
  }
  for (const e of errors) {
    lines.push(`  ! error: ${e}`);
  }

  return { lines, exported, hasErrors: errors.length > 0 || errored.length > 0 };
}

export function register(server, ctx) {
  const { log } = ctx;

  // ── Tool: hermit_skill_list ────────────────────────────────────────
  server.tool(
    'hermit_skill_list',
    'List available hermit skills with per-agent compatibility.',
    { agent: z.enum(AGENT_NAMES).optional().describe('Filter by agent compatibility') },
    async ({ agent }) => {
      const skills = discoverSkills();
      const projectSkills = discoverProjectSkills();
      if (!skills.length && !projectSkills.length) return ok('No skills found.');

      const lines = [];

      if (skills.length) {
        lines.push(`Hermit Catalog Skills (${skills.length})\n`);
        for (const skill of skills) {
          const compat = AGENT_NAMES.filter(a => checkCompat(skill.fm, AGENTS[a]));
          if (agent && !compat.includes(agent)) continue;
          const compatStr = compat.join(', ');
          const note = compat.length < AGENT_NAMES.length ? '  [MCP required]' : '';
          lines.push(`  ${skill.name.padEnd(22)} Compatible: ${compatStr}${note}`);
        }
      }

      if (projectSkills.length) {
        lines.push(`\nProject Skills from .claude/skills/ (${projectSkills.length})\n`);
        for (const skill of projectSkills) {
          const desc = skill.fm?.description || '';
          const descStr = desc ? ` — ${desc.slice(0, 60)}` : '';
          lines.push(`  ${skill.name.padEnd(22)}${descStr}`);
        }
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
      agent: z.enum([...AGENT_NAMES, 'all']).describe('Target agent (claude/cursor/gemini/codex/opencode/all)'),
      project: z.string().optional().describe('Project root path for project-mode export'),
      global: z.boolean().optional().default(false).describe('Export to agent global config dir'),
    },
    async ({ skillName, agent, project, global: isGlobal }) => {
      const projErr = validateProject(project);
      if (projErr) return projErr;

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

      // Also include project skills when exporting __all__
      if (skillName === '__all__') {
        for (const ag of agents) {
          try { results.push(...exportAllProjectSkills(ag, opts)); }
          catch (err) { errors.push(`${ag} (project): ${err.message}`); }
        }
      }

      const { lines, exported, hasErrors } = formatExportResults(results, errors, 'skill');
      if (!exported.length && hasErrors) return fail(lines.join('\n'));
      return ok(lines.join('\n'));
    }
  );

  // ── Tool: hermit_command_list ──────────────────────────────────────
  server.tool(
    'hermit_command_list',
    'List available hermit commands (slash commands) from catalog.',
    { agent: z.enum(AGENT_NAMES).optional().describe('Filter by agent (informational only)') },
    async ({ agent }) => {
      const commands = discoverCommands();
      if (!commands.length) return ok('No commands found in catalog/commands/.');

      const lines = [`Hermit Commands (${commands.length} available)\n`];

      for (const cmd of commands) {
        const desc = cmd.fm?.description || '';
        const descStr = desc ? ` — ${desc}` : '';
        lines.push(`  /${cmd.name.padEnd(20)}${descStr}`);
      }

      if (agent) {
        const strategy = AGENTS[agent]?.commands?.strategy || 'per-file';
        lines.push(`\n  Export strategy for ${agent}: ${strategy}`);
      }

      return ok(lines.join('\n'));
    }
  );

  // ── Tool: hermit_command_export ────────────────────────────────────
  server.tool(
    'hermit_command_export',
    'Export hermit command(s) to an AI agent. Writes files to agent-specific locations.',
    {
      commandName: z.string().describe('Command name from catalog, or "__all__" for all commands'),
      agent: z.enum([...AGENT_NAMES, 'all']).describe('Target agent (claude/cursor/gemini/codex/opencode/all)'),
      project: z.string().optional().describe('Project root path for project-mode export'),
      global: z.boolean().optional().default(false).describe('Export to agent global config dir'),
    },
    async ({ commandName, agent, project, global: isGlobal }) => {
      const projErr = validateProject(project);
      if (projErr) return projErr;

      const opts = { project, global: isGlobal || !project };
      const agents = agent === 'all' ? AGENT_NAMES : [agent];
      const results = [];
      const errors = [];

      for (const ag of agents) {
        try {
          if (commandName === '__all__') {
            results.push(...exportAllCommands(ag, opts));
          } else {
            results.push(exportCommand(commandName, ag, opts));
          }
        } catch (err) {
          errors.push(`${ag}: ${err.message}`);
        }
      }

      const { lines, exported, hasErrors } = formatExportResults(results, errors, 'command');
      if (!exported.length && hasErrors) return fail(lines.join('\n'));
      return ok(lines.join('\n'));
    }
  );

  // ── Tool: hermit_hook_list ─────────────────────────────────────────
  server.tool(
    'hermit_hook_list',
    'List available hermit hooks with agent compatibility.',
    { agent: z.enum(AGENT_NAMES).optional().describe('Filter by target agent') },
    async ({ agent }) => {
      const hooks = discoverHooks();
      if (!hooks.length) return ok('No hooks found in catalog/hooks/.');

      const filtered = agent ? hooks.filter(h => h.agent === agent) : hooks;
      if (!filtered.length) return ok(`No hooks found for agent: ${agent}`);

      // Group by purpose
      const byPurpose = {};
      for (const h of filtered) {
        if (!byPurpose[h.purpose]) byPurpose[h.purpose] = [];
        byPurpose[h.purpose].push(h);
      }

      const lines = [`Hermit Hooks (${filtered.length} shown, ${hooks.length} total)\n`];

      for (const [purpose, purposeHooks] of Object.entries(byPurpose)) {
        const agents = purposeHooks.map(h => h.agent).join(', ');
        lines.push(`  ${purpose.padEnd(25)} Agents: ${agents}`);
        for (const h of purposeHooks) {
          lines.push(`    ${h.filename}${h.hasLib ? ' [+lib]' : ''}`);
        }
      }

      return ok(lines.join('\n'));
    }
  );

  // ── Tool: hermit_hook_export ───────────────────────────────────────
  server.tool(
    'hermit_hook_export',
    'Export hermit hook(s) to an AI agent. Copies hook files + lib/ dependencies.',
    {
      hookName: z.string().describe('Hook filename, or "__all__" for all hooks for the agent'),
      agent: z.enum(AGENT_NAMES).describe('Target agent (claude/cursor/gemini/codex/opencode)'),
      project: z.string().optional().describe('Project root path for project-mode export'),
      global: z.boolean().optional().default(false).describe('Export to agent global config dir'),
    },
    async ({ hookName, agent, project, global: isGlobal }) => {
      const projErr = validateProject(project);
      if (projErr) return projErr;

      const opts = { project, global: isGlobal || !project };
      const results = [];
      const errors = [];

      try {
        if (hookName === '__all__') {
          results.push(...exportAllHooks(agent, opts));
        } else {
          results.push(exportHook(hookName, agent, opts));
        }
      } catch (err) {
        errors.push(`${agent}: ${err.message}`);
      }

      const { lines, exported, hasErrors } = formatExportResults(results, errors, 'hook');
      if (!exported.length && hasErrors) return fail(lines.join('\n'));
      return ok(lines.join('\n'));
    }
  );

  log('skills-module: 6 tools registered');
}
