/**
 * Intelligence Module — audit trail, consolidation, branch context.
 * 3 tools: hermit_audit_trail, hermit_consolidate, hermit_branch_context.
 */

import { z } from 'zod';
import { readBrain, writeBrain, withBrainLock } from './brain-io.mjs';
import { getEntityHistory, repointRelations } from './audit-trail.mjs';
import { obsText, parseObservation } from './parse-observation.mjs';
import { detectBranch } from './branch-context.mjs';
import { zNumber, zBoolean } from './zod-coerce.mjs';

const RO = { readOnlyHint: true };

function ok(text) { return { content: [{ type: 'text', text }] }; }
function fail(text) { return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true }; }

function findEntity(entities, name) {
  const lower = name.toLowerCase();
  for (const [k, v] of entities) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

/**
 * Register 3 intelligence tools.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} ctx
 */
export function register(server, ctx) {
  const { brainPath, log } = ctx;

  // ── T1: Audit Trail ──
  server.tool('hermit_audit_trail', 'View observation change history for an entity — append-only audit log', {
    entityName: z.string().min(1).describe('Entity name to view history for'),
    limit: zNumber().int().min(1).max(100).optional().default(20),
  }, RO, async ({ entityName, limit }) => {
    const { entities } = readBrain(brainPath);
    const entity = findEntity(entities, entityName);
    if (!entity) return fail(`Entity "${entityName}" not found.`);

    const history = getEntityHistory(entity);
    if (!history.length) {
      const obsCount = (entity.observations || []).length;
      return ok(`## Audit Trail: ${entity.name}\n\nNo change history. ${obsCount} observations, all original.`);
    }

    const entries = history.slice(0, limit).map((h, i) => {
      const date = h.changedAt ? h.changedAt.slice(0, 19).replace('T', ' ') : '?';
      const content = (h.content || '').slice(0, 80);
      return `${i + 1}. **${h.reason}** at ${date}\n   "${content}"`;
    });

    return ok(`## Audit Trail: ${entity.name}\n\n${history.length} total changes (showing ${entries.length}):\n\n${entries.join('\n\n')}`);
  });

  // ── T2: Consolidate ──
  server.tool('hermit_consolidate', 'Run consolidation — dedup entities, flag contradictions. Use dry_run=true to preview', {
    dryRun: zBoolean().optional().default(true).describe('Preview changes without applying'),
  }, async ({ dryRun }) => {
    try {
      const report = await withBrainLock(brainPath, () => {
        const { entities, relations } = readBrain(brainPath);
        const dupes = findDuplicates(entities);
        const contradictions = findContradictions(entities);

        if (!dryRun && dupes.length > 0) {
          applyDedup(entities, dupes, relations);
          writeBrain(brainPath, entities, relations);
        }

        return formatConsolidationReport(dupes, contradictions, dryRun);
      });
      return ok(report);
    } catch (e) { return fail(e.message); }
  });

  // ── T3: Branch Context ──
  // The set_filter / clear_filter actions were removed: the filter they set was
  // never applied by any search path, so they only ever reported success while
  // doing nothing. Memory is intentionally global — use project scoping
  // (hermit_search_nodes cwd/scope) to narrow recall instead.
  server.tool('hermit_branch_context', 'Report the current git branch for the working directory. Memory is global (not branch-scoped) — to narrow recall, use the cwd/scope parameters on hermit_search_nodes.', {
    cwd: z.string().optional().describe('Working directory for branch detection'),
  }, RO, async ({ cwd }) => {
    const detected = detectBranch(cwd);
    return ok(`## Branch Context\n\n- Current branch: ${detected}\n- Memory scoping: project-based (see hermit_search_nodes cwd/scope), not branch-based`);
  });

  log('intelligence-module: 3 tools registered');
}

// ── Consolidation helpers ──

function findDuplicates(entities) {
  const groups = new Map();
  for (const [name, entity] of entities) {
    if (entity._archived) continue;
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entity);
  }
  const dupes = [];
  for (const [key, group] of groups) {
    if (group.length > 1) dupes.push({ key, entities: group });
  }
  return dupes;
}

function findContradictions(entities) {
  const flags = [];
  for (const [, entity] of entities) {
    if (entity._archived) continue;
    const obs = (entity.observations || []).filter(o => {
      if (typeof o === 'string') return true;
      return !o._archived;
    });
    for (let i = 0; i < obs.length; i++) {
      for (let j = i + 1; j < obs.length; j++) {
        const textI = obsText(obs[i]).toLowerCase();
        const textJ = obsText(obs[j]).toLowerCase();
        const prefixI = textI.match(/^(\w+):/)?.[1];
        const prefixJ = textJ.match(/^(\w+):/)?.[1];
        if (prefixI && prefixI === prefixJ && textI !== textJ) {
          const wordsI = new Set(textI.split(/\s+/));
          const wordsJ = new Set(textJ.split(/\s+/));
          const shared = [...wordsI].filter(w => wordsJ.has(w)).length;
          const similarity = shared / Math.max(wordsI.size, wordsJ.size);
          if (similarity > 0.5 && similarity < 1.0) {
            flags.push({
              entity: entity.name,
              obsA: obsText(obs[i]).slice(0, 80),
              obsB: obsText(obs[j]).slice(0, 80),
              similarity: similarity.toFixed(2),
            });
          }
        }
      }
    }
  }
  return flags;
}

/**
 * Merge duplicate entity groups into their first member.
 * Relations on the merged-away entity are repointed to the survivor — the
 * knowledge moved, so its edges must move with it. Leaving them behind was the
 * source of most dangling relations on the real graph.
 * @param {Map} entities
 * @param {Array} dupes
 * @param {Array} relations - mutated in place
 * @returns {number} relations repointed
 */
function applyDedup(entities, dupes, relations = []) {
  let repointed = 0;
  for (const { entities: group } of dupes) {
    const primary = group[0];
    for (let i = 1; i < group.length; i++) {
      const secondary = group[i];
      primary.observations = [...(primary.observations || []), ...(secondary.observations || [])];
      secondary._archived = true;
      secondary._archivedAt = new Date().toISOString();
      secondary._history = [...(secondary._history || []), { action: 'merged_into', target: primary.name, at: secondary._archivedAt }];
      repointed += repointRelations(relations, secondary.name, primary.name);
    }
  }
  return repointed;
}

function formatConsolidationReport(dupes, contradictions, dryRun) {
  const mode = dryRun ? 'DRY RUN' : 'APPLIED';
  const lines = [`## Consolidation Report (${mode})\n`];

  lines.push(`### Duplicates: ${dupes.length} groups`);
  if (dupes.length) {
    for (const d of dupes.slice(0, 10)) {
      const names = d.entities.map(e => e.name).join(', ');
      lines.push(`- "${d.key}": ${d.entities.length} entities (${names})`);
    }
    if (!dryRun) lines.push(`\n*${dupes.length} groups merged.*`);
  } else {
    lines.push('No duplicates found.');
  }

  lines.push(`\n### Contradictions: ${contradictions.length} flags`);
  if (contradictions.length) {
    for (const c of contradictions.slice(0, 10)) {
      lines.push(`- **${c.entity}** (${c.similarity} similarity):\n  A: "${c.obsA}"\n  B: "${c.obsB}"`);
    }
  } else {
    lines.push('No contradictions detected.');
  }

  return lines.join('\n');
}
