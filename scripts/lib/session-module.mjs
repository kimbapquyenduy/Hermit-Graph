/**
 * session-module.mjs — MCP session context for all agents.
 *
 * Provides two capabilities:
 *   - Tool `hermit_session_start`: call once per conversation for project-scoped KG context
 *   - Resource `hermit://context/auto`: subscribable project context summary
 *
 * This bridges the gap for non-Claude agents (Cursor, Windsurf, Cline, Codex)
 * that lack hooks but can use MCP tools and resources.
 */

import { z } from 'zod';
import { readBrain } from './brain-io.mjs';
import { recallEntities, detectScope } from './session-recall.mjs';
import { detectBranch, setBranchFilter } from './branch-context.mjs';

function ok(text) { return { content: [{ type: 'text', text }] }; }

function formatEntityBlock(entity, maxObs) {
  const lines = [`### ${entity.name} (${entity.entityType})`];
  const obs = entity.observations.slice(0, maxObs);
  for (const o of obs) lines.push(`- ${o}`);
  if (entity.observations.length > maxObs) {
    lines.push(`- ... +${entity.observations.length - maxObs} more (use open_nodes("${entity.name}") for details)`);
  }
  return lines.join('\n');
}

export function register(server, ctx) {
  const { brainPath, log } = ctx;

  // ── Tool: hermit_session_start ──────────────────────────────────────
  server.tool(
    'hermit_session_start',
    'Call once at conversation start. Returns project-scoped KG context and sets branch filter.',
    {
      cwd: z.string().optional().describe('Project working directory for scope detection'),
      query: z.string().optional().describe('Optional initial topic for targeted recall'),
    },
    async ({ cwd, query }) => {
      const workDir = cwd || process.cwd();

      // Detect and set branch filter
      const branch = detectBranch(workDir);
      if (branch !== 'unknown') setBranchFilter(branch);

      // Recall project-scoped entities
      const result = recallEntities(brainPath, {
        cwd: workDir,
        query: query || '',
        maxResults: 8,
        maxObsPerEntity: 3,
      });

      // Graph stats
      const { entities: allEntities, relations } = readBrain(brainPath);

      const lines = [
        '## Hermit Session Context',
        `Branch: ${branch} | Scope: ${result.scope} | Graph: ${allEntities.size} entities, ${relations.length} relations`,
        '',
      ];

      if (result.entities.length) {
        lines.push(`### Relevant Knowledge (${result.entities.length} entities)\n`);
        for (const e of result.entities) {
          lines.push(formatEntityBlock(e, 3), '');
        }
      } else {
        lines.push('No project-specific knowledge found yet. Save knowledge as you work.\n');
      }

      lines.push('### Quick Reference');
      lines.push('- Save: `hermit_create_entities` with TIER:SCOPE:LABEL naming');
      lines.push('- Search: `hermit_search_nodes` before creating (avoid duplicates)');
      lines.push('- Observation format: `[confidence|YYYY-MM-DD] TEXT`');

      return ok(lines.join('\n'));
    }
  );

  // ── Resource: hermit://context/auto ─────────────────────────────────
  server.resource(
    'project-context',
    'hermit://context/auto',
    { description: 'Auto-detected project KG context. Read at session start for context injection.' },
    async (uri) => {
      const workDir = process.cwd();
      const result = recallEntities(brainPath, {
        cwd: workDir,
        maxResults: 10,
        maxObsPerEntity: 2,
      });

      const { entities: allEntities, relations } = readBrain(brainPath);
      const { scope } = detectScope(workDir, brainPath);

      const lines = [
        '# Hermit Knowledge Context',
        `Scope: ${scope} | Entities: ${allEntities.size} | Relations: ${relations.length}`,
        '',
      ];

      for (const e of result.entities) {
        lines.push(formatEntityBlock(e, 2), '');
      }

      if (result.entities.length === 0) {
        lines.push('No project-specific knowledge found yet.');
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/markdown',
          text: lines.join('\n'),
        }],
      };
    }
  );

  log('session-module: 1 tool + 1 resource registered');
}
