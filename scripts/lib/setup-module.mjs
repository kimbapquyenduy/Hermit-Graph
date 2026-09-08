/**
 * setup-module.mjs — MCP tool for one-call agent onboarding.
 *
 * Tool: hermit_setup
 * Exports all commands, hooks, skills for any agent via MCP.
 * Replaces the need to run `hermit setup` CLI for non-Claude agents.
 */

import { z } from 'zod';
import { exportAll } from './skill-export.mjs';
import { exportAllCommands } from './skill-export.mjs';
import { exportAllHooks } from './hook-export.mjs';
import { exportAllProjectSkills } from './project-skill-export.mjs';
import { learnProject } from './project-learner.mjs';
import { AGENTS } from './skill-adapters.mjs';
import { zBoolean } from './zod-coerce.mjs';

const IDEM = { idempotentHint: true };

function ok(text) { return { content: [{ type: 'text', text }] }; }
function fail(text) { return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true }; }

const AGENT_NAMES = Object.keys(AGENTS);

export function register(server, ctx) {
  const { store, log } = ctx;

  server.tool(
    'hermit_setup',
    'One-call agent onboarding. Exports all commands, hooks, skills, learns project identity.',
    {
      agent: z.enum([...AGENT_NAMES, 'all']).describe('Target agent (claude/cursor/gemini/cline/codex/opencode/all)'),
      cwd: z.string().optional().describe('Project working directory for auto-learn'),
      global: zBoolean().optional().default(true).describe('Export to agent global config dir'),
    },
    IDEM,
    async ({ agent, cwd, global: isGlobal }) => {
      const workDir = cwd || ctx.memoryService?.sessionRootPath || ctx.service?.sessionRootPath;
      if(!workDir)return fail('Explicit project cwd or started session required');
      const agents = agent === 'all' ? AGENT_NAMES : [agent];
      const opts = { global: isGlobal };

      const results = { commands: [], hooks: [], skills: [], errors: [] };

      // 2. Export commands for each agent
      for (const ag of agents) {
        try {
          const cmdResults = exportAllCommands(ag, opts);
          const exported = cmdResults.filter(r => r.action !== 'skipped' && r.action !== 'error');
          results.commands.push(...exported);
        } catch (err) {
          results.errors.push(`commands/${ag}: ${err.message}`);
        }
      }

      // 3. Export hooks for each agent
      for (const ag of agents) {
        try {
          const hookResults = exportAllHooks(ag, opts);
          const exported = hookResults.filter(r => r.action !== 'skipped' && r.action !== 'error');
          results.hooks.push(...exported);
        } catch (err) {
          results.errors.push(`hooks/${ag}: ${err.message}`);
        }
      }

      // 4. Export catalog skills for each agent
      for (const ag of agents) {
        try {
          const skillResults = exportAll(ag, opts);
          const exported = skillResults.filter(r => r.action !== 'skipped' && r.action !== 'error');
          results.skills.push(...exported);
        } catch (err) {
          results.errors.push(`skills/${ag}: ${err.message}`);
        }
      }

      // 5. Export project skills
      for (const ag of agents) {
        try {
          const projResults = exportAllProjectSkills(ag, opts);
          const exported = projResults.filter(r => r.action !== 'skipped' && r.action !== 'error');
          results.skills.push(...exported);
        } catch (err) {
          // Project skills are optional, don't fail
        }
      }

      // 6. Auto-learn project identity
      let learnResult = null;
      try {
        learnResult = await learnProject(workDir, {store, silent:true});
      } catch (err) {
        results.errors.push(`learn: ${err.message}`);
      }

      // Build response
      const lines = [
        '## Hermit Setup Complete',
        `Agents: ${agents.join(', ')}`,
        `Commands exported: ${results.commands.length}`,
        `Hooks exported: ${results.hooks.length}`,
        `Skills exported: ${results.skills.length}`,
      ];

      if (learnResult) {
        lines.push(`Project learned: ${learnResult.projectName} (${learnResult.entities} entities, ${learnResult.observations} observations)`);
      }

      if (results.commands.length) {
        lines.push('', '### Commands');
        for (const r of results.commands) {
          lines.push(`  ${r.action === 'created' ? '+' : '~'} ${r.path || r.name} [${r.agent}]`);
        }
      }

      if (results.hooks.length) {
        lines.push('', '### Hooks');
        for (const r of results.hooks) {
          lines.push(`  ${r.action === 'created' ? '+' : '~'} ${r.path || r.name} [${r.agent}]`);
        }
      }

      if (results.skills.length) {
        lines.push('', '### Skills');
        for (const r of results.skills) {
          lines.push(`  ${r.action === 'created' ? '+' : '~'} ${r.path || r.name} [${r.agent}]`);
        }
      }

      if (results.errors.length) {
        lines.push('', '### Warnings');
        for (const e of results.errors) {
          lines.push(`  ! ${e}`);
        }
      }

      lines.push('', '### Next Steps');
      lines.push('1. Restart your AI agent to load new configuration');
      lines.push('2. Run `hermit_deep_scan` for full project knowledge extraction');
      lines.push('3. Edit BUSINESS.md with your project business rules');

      return ok(lines.join('\n'));
    }
  );

  log('setup-module: 1 tool registered');
}
