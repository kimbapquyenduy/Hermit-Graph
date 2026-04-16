/**
 * Memory Module — 10 KG CRUD tools on brain.jsonl.
 * Replaces @sockeye44/better-memory-mcp with native MCP tools.
 */

import { z } from 'zod';
import { readBrain, writeBrain, withBrainLock } from './brain-io.mjs';
import { search } from './semantic-search.mjs';
import { obsText, parseObservation } from './parse-observation.mjs';
import { archiveObservation, appendHistory } from './audit-trail.mjs';

const MAX_RESPONSE_CHARS = 25000;

// ── Write Validation (universal — works for ALL agents) ──

/** Observation prefix: [confidence|YYYY-MM-DD] */
const OBS_PREFIX_RE = /^\[[\d.]+\|\d{4}-\d{2}-\d{2}\]/;

/** Validate observations have required prefix. Returns invalid texts or empty array. */
function validateObservations(observations) {
  const invalid = [];
  for (const obs of observations) {
    const text = typeof obs === 'string' ? obs : (obs?.content || '');
    if (text && !OBS_PREFIX_RE.test(text)) {
      invalid.push(text.slice(0, 80));
    }
  }
  return invalid;
}

/** Build validation error message. */
function obsValidationError(invalid) {
  return `Observations missing [confidence|YYYY-MM-DD] prefix:\n${invalid.map(i => `- "${i}"`).join('\n')}\n\nRequired format: [confidence|YYYY-MM-DD] TEXT\nExample: [0.8|${new Date().toISOString().slice(0, 10)}] RULE: Max discount 50%\nConfidence: 0.6 (auto-detected) | 0.8 (default) | 0.95 (user-stated)`;
}

/** Case-insensitive entity lookup. */
function findEntity(entities, name) {
  const lower = name.toLowerCase();
  for (const [k, v] of entities) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

/** Keyword relevance score for search. */
function keywordMatch(query, entity) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (!terms.length) return 0;
  const text = [entity.name, entity.entityType, ...(entity.observations || []).map(o => obsText(o))].join(' ').toLowerCase();
  let hits = 0;
  for (const t of terms) { if (text.includes(t)) hits++; }
  return hits / terms.length;
}

// ── Contradiction Detection ──

/** Known observation category prefixes for conflict matching. */
const OBS_CATEGORY_RE = /^(RULE|WHAT|WHEN|WHERE|WHY|HOW|STACK|FLOW|TRIGGER|SIDE_EFFECTS?|EDGE_CASE|FIELDS?|STATUS(?:ES)?|CONSTRAINTS?|FRONTEND|BACKEND|INFRA|CI_CD|SYMPTOM|ROOT_CAUSE|FIX|FILES?|TIME|PROJECT|DECISION|REASON|TRADEOFF|ALTERNATIVES?|MODEL|PRIMARY|ALTERNATIVE|FUTURE)[:\s]/i;

/**
 * Extract category prefix from observation text (after stripping [confidence|date]).
 * Returns null if no known category found.
 * @param {string} obsRaw - Raw observation (string or object)
 * @returns {string|null} Uppercase category like "RULE", "WHAT", etc.
 */
function extractObsCategory(obsRaw) {
  const { text } = parseObservation(obsRaw);
  const match = text.match(OBS_CATEGORY_RE);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Detect and resolve contradictions when merging observations into existing entity.
 * Same entity + same category prefix = contradiction → archive old, keep new.
 * @param {Array} existingObs - Current observations on entity
 * @param {Array} newObs - Incoming observations to merge
 * @param {Function} logFn - Logger function
 * @param {string} entityName - For logging
 * @returns {{ merged: Array, superseded: number }} Updated observations + count of superseded
 */
function resolveContradictions(existingObs, newObs, logFn, entityName) {
  // Index new observations by category
  const newCategories = new Map();
  for (const obs of newObs) {
    const cat = extractObsCategory(typeof obs === 'string' ? obs : (obs?.content || ''));
    if (cat) newCategories.set(cat, obs);
  }

  if (newCategories.size === 0) {
    // No categorized observations — just append, no contradiction possible
    return { merged: [...existingObs, ...newObs], superseded: 0 };
  }

  // Check existing observations for same-category conflicts
  let superseded = 0;
  const updated = existingObs.map(obs => {
    const text = obsText(obs);
    // Skip already-archived observations
    if (typeof obs === 'object' && obs._archived) return obs;

    const cat = extractObsCategory(text);
    if (cat && newCategories.has(cat)) {
      // Contradiction found — archive old observation
      logFn(`contradiction detected on "${entityName}" category=${cat}: superseding old observation`);
      superseded++;
      const archived = appendHistory(obs, 'superseded');
      return { ...archived, _archived: true, _archivedAt: new Date().toISOString(), _superseded_by: 'newer_observation' };
    }
    return obs;
  });

  return { merged: [...updated, ...newObs], superseded };
}

/** Truncate text with pagination hint. */
function truncate(text) {
  if (text.length <= MAX_RESPONSE_CHARS) return text;
  return text.slice(0, MAX_RESPONSE_CHARS) + '\n\n...(truncated — use filters or smaller limit)';
}

/** Format entity for display. */
function fmtEntity(e, detail = 'full') {
  if (detail === 'name-only') return `- ${e.name} (${e.entityType})`;
  const obs = (e.observations || [])
    .filter(o => typeof o === 'string' || !o._archived)
    .map(o => `  - ${obsText(o)}`).join('\n');
  return `### ${e.name} (${e.entityType})\n${obs || '  (no observations)'}`;
}

/** MCP text response helper. */
function ok(text) { return { content: [{ type: 'text', text }] }; }
function fail(text) { return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true }; }

/**
 * Register all 10 memory tools.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} ctx - Shared context { brainPath, log }
 */
export function register(server, ctx) {
  const { brainPath, log } = ctx;

  // Expose brain readers for other modules
  ctx.getEntities = () => readBrain(brainPath).entities;
  ctx.getRelations = () => readBrain(brainPath).relations;

  // ── T1: Create Entities ──
  server.tool('hermit_create_entities', 'Create or merge entities in the knowledge graph. Deduplicates by name (case-insensitive)', {
    entities: z.array(z.object({
      name: z.string().min(1).describe('Entity name (TIER:SCOPE:LABEL format)'),
      entityType: z.string().min(1).describe('One of 13 entity types'),
      observations: z.array(z.string()).min(1).describe('Observations with [confidence|date] prefix'),
    })).min(1),
  }, async ({ entities: input }) => {
    // Validate all observations before writing
    for (const item of input) {
      const invalid = validateObservations(item.observations || []);
      if (invalid.length > 0) return fail(obsValidationError(invalid));
    }

    const result = await withBrainLock(brainPath, () => {
      const { entities, relations } = readBrain(brainPath);
      let created = 0, merged = 0, typeConflicts = 0, superseded = 0;
      for (const item of input) {
        const existing = findEntity(entities, item.name);
        if (existing) {
          if (item.entityType && existing.entityType !== item.entityType) {
            log(`hermit_create_entities: type conflict for "${item.name}" — existing "${existing.entityType}", incoming "${item.entityType}" (existing preserved)`);
            typeConflicts++;
          }
          // Contradiction detection: same category observations get superseded
          const resolution = resolveContradictions(existing.observations || [], item.observations, log, item.name);
          existing.observations = resolution.merged;
          superseded += resolution.superseded;
          merged++;
        } else {
          entities.set(item.name, { type: 'entity', name: item.name, entityType: item.entityType, observations: item.observations });
          created++;
        }
      }
      writeBrain(brainPath, entities, relations);
      return { created, merged, typeConflicts, superseded };
    });
    const conflictNote = result.typeConflicts > 0 ? ` (${result.typeConflicts} type conflicts — existing types preserved)` : '';
    const supersededNote = result.superseded > 0 ? ` (${result.superseded} contradicting observations superseded)` : '';
    return ok(`Created ${result.created}, merged ${result.merged} entities.${conflictNote}${supersededNote}`);
  });

  // ── T2: Create Relations ──
  server.tool('hermit_create_relations', 'Create relations between entities. Deduplicates by from+to+relationType', {
    relations: z.array(z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      relationType: z.string().min(1),
    })).min(1),
  }, async ({ relations: input }) => {
    const result = await withBrainLock(brainPath, () => {
      const { entities, relations } = readBrain(brainPath);
      let created = 0, skipped = 0, missing = 0;
      for (const rel of input) {
        if (!findEntity(entities, rel.from) || !findEntity(entities, rel.to)) {
          log(`hermit_create_relations: skipping relation "${rel.from}" → "${rel.to}" — one or both entities not found`);
          missing++;
          continue;
        }
        const exists = relations.some(r => r.from === rel.from && r.to === rel.to && r.relationType === rel.relationType);
        if (exists) { skipped++; continue; }
        relations.push({ type: 'relation', ...rel });
        created++;
      }
      writeBrain(brainPath, entities, relations);
      return { created, skipped, missing };
    });
    const missingNote = result.missing > 0 ? ` (${result.missing} skipped — entity not found)` : '';
    return ok(`Created ${result.created} relations (${result.skipped} duplicates skipped).${missingNote}`);
  });

  // ── T3: Search Nodes (keyword) ──
  server.tool('hermit_search_nodes', 'Keyword search across entity names, types, and observations', {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional().default(10),
    include_archived: z.boolean().optional().default(false),
  }, async ({ query, limit, include_archived }) => {
    const { entities } = readBrain(brainPath);
    let results = [];
    for (const [, e] of entities) {
      if (!include_archived && e._archived) continue;
      const score = keywordMatch(query, e);
      if (score > 0) results.push({ entity: e, score });
    }
    results.sort((a, b) => b.score - a.score);
    results = results.slice(0, limit);
    if (!results.length) return ok(`No results for "${query}".`);
    const lines = results.map(r => `${r.score.toFixed(2)}  ${r.entity.name} (${r.entity.entityType})`);
    return ok(`## Search: "${query}"\n\n${lines.join('\n')}\n\n${results.length} results`);
  });

  // ── T4: Semantic Search ──
  server.tool('hermit_semantic_search', 'Hybrid vector + keyword search (falls back to keyword-only if no embeddings)', {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional().default(10),
  }, async ({ query, limit }) => {
    try {
      const results = await search(query, { topK: limit });
      if (!results.length) return ok(`No results for "${query}".`);
      const lines = results.map(r => `${r.score.toFixed(3)}  ${r.name} (${r.entityType}) [${r.observationCount} obs]`);
      return ok(`## Semantic Search: "${query}"\n\n${lines.join('\n')}\n\n${results.length} results`);
    } catch (e) {
      log(`semantic_search error: ${e.message}`);
      return fail(`Semantic search failed: ${e.message}`);
    }
  });

  // ── T5: Open Nodes ──
  server.tool('hermit_open_nodes', 'Read full entity details by name(s)', {
    names: z.array(z.string().min(1)).min(1).max(20),
  }, async ({ names }) => {
    const { entities } = readBrain(brainPath);
    const found = [], missing = [];
    for (const name of names) {
      const e = findEntity(entities, name);
      if (e) found.push(fmtEntity(e));
      else missing.push(name);
    }
    let text = found.join('\n\n');
    if (missing.length) text += `\n\nNot found: ${missing.join(', ')}`;
    return ok(truncate(text || 'No entities found.'));
  });

  // ── T6: Add Observations ──
  server.tool('hermit_add_observations', 'Append observations to an existing entity', {
    entityName: z.string().min(1),
    observations: z.array(z.string()).min(1),
  }, async ({ entityName, observations: newObs }) => {
    // Validate observations before writing
    const invalid = validateObservations(newObs);
    if (invalid.length > 0) return fail(obsValidationError(invalid));

    const result = await withBrainLock(brainPath, () => {
      const { entities, relations } = readBrain(brainPath);
      const entity = findEntity(entities, entityName);
      if (!entity) return null;
      entity.observations = [...(entity.observations || []), ...newObs];
      writeBrain(brainPath, entities, relations);
      return entity.observations.length;
    });
    if (result === null) return fail(`Entity "${entityName}" not found.`);
    return ok(`Added ${newObs.length} observations. Total: ${result}.`);
  });

  // ── T7: Archive Entities (with audit trail) ──
  server.tool('hermit_archive_entities', 'Soft-delete entities (set _archived=true)', {
    names: z.array(z.string().min(1)).min(1),
  }, async ({ names }) => {
    const result = await withBrainLock(brainPath, () => {
      const { entities, relations } = readBrain(brainPath);
      let archived = 0;
      for (const name of names) {
        const entity = findEntity(entities, name);
        if (entity && !entity._archived) {
          entity._archived = true;
          entity._archivedAt = new Date().toISOString();
          entity.observations = (entity.observations || []).map(obs => archiveObservation(obs));
          entity._history = [...(entity._history || []), { action: 'archived', at: entity._archivedAt }];
          archived++;
        }
      }
      writeBrain(brainPath, entities, relations);
      return archived;
    });
    return ok(`Archived ${result} entities.`);
  });

  // ── T8: Archive Observations (with audit trail) ──
  server.tool('hermit_archive_observations', 'Soft-archive specific observations within an entity by content match', {
    entityName: z.string().min(1),
    observations: z.array(z.string()).min(1).describe('Observation texts to archive (partial match)'),
  }, async ({ entityName, observations: targets }) => {
    const result = await withBrainLock(brainPath, () => {
      const { entities, relations } = readBrain(brainPath);
      const entity = findEntity(entities, entityName);
      if (!entity) return null;
      let count = 0;
      entity.observations = (entity.observations || []).map(obs => {
        const text = obsText(obs);
        if (targets.some(t => text.includes(t))) {
          const isObj = typeof obs === 'object';
          if (!isObj || !obs._archived) {
            count++;
            return archiveObservation(obs);
          }
        }
        return obs;
      });
      writeBrain(brainPath, entities, relations);
      return count;
    });
    if (result === null) return fail(`Entity "${entityName}" not found.`);
    return ok(`Archived ${result} observations.`);
  });

  // ── T9: Get Related ──
  server.tool('hermit_get_related', 'Traverse relations from an entity (BFS, 1-5 hops)', {
    name: z.string().min(1),
    depth: z.number().int().min(1).max(5).optional().default(1),
    relationType: z.string().optional(),
  }, async ({ name, depth, relationType }) => {
    const { entities, relations } = readBrain(brainPath);
    if (!findEntity(entities, name)) return fail(`Entity "${name}" not found.`);
    const visited = new Set();
    const results = [];
    let queue = [{ n: name, d: 0 }];
    while (queue.length) {
      const { n: cur, d } = queue.shift();
      const curLower = cur.toLowerCase();
      if (visited.has(curLower) || d > depth) continue;
      visited.add(curLower);
      if (d > 0) {
        const e = findEntity(entities, cur);
        results.push(`  d=${d}  ${cur}${e ? ` (${e.entityType})` : ''}`);
      }
      for (const r of relations) {
        if (relationType && r.relationType !== relationType) continue;
        let neighbor = null;
        if (r.from.toLowerCase() === curLower) neighbor = r.to;
        else if (r.to.toLowerCase() === curLower) neighbor = r.from;
        if (neighbor && !visited.has(neighbor.toLowerCase())) queue.push({ n: neighbor, d: d + 1 });
      }
    }
    if (!results.length) return ok(`No related entities found for "${name}".`);
    return ok(`## Related to: ${name}\n\n${results.join('\n')}\n\n${results.length} entities`);
  });

  // ── T10: Read Graph ──
  server.tool('hermit_read_graph', 'Read knowledge graph with filters', {
    detailLevel: z.enum(['minimal', 'detail', 'entity-list']).optional().default('minimal'),
    entityNames: z.array(z.string()).optional(),
    entityTypes: z.array(z.string()).optional(),
    include_archived: z.boolean().optional().default(false),
  }, async ({ detailLevel, entityNames, entityTypes, include_archived }) => {
    const { entities, relations } = readBrain(brainPath);
    let filtered = [...entities.values()];
    if (!include_archived) filtered = filtered.filter(e => !e._archived);
    if (entityNames?.length) {
      const set = new Set(entityNames.map(n => n.toLowerCase()));
      filtered = filtered.filter(e => set.has(e.name.toLowerCase()));
    }
    if (entityTypes?.length) {
      const set = new Set(entityTypes.map(t => t.toLowerCase()));
      filtered = filtered.filter(e => set.has((e.entityType || '').toLowerCase()));
    }

    if (detailLevel === 'minimal') {
      const typeMap = {};
      for (const e of filtered) typeMap[e.entityType] = (typeMap[e.entityType] || 0) + 1;
      const dist = Object.entries(typeMap).map(([t, c]) => `  ${t}: ${c}`).join('\n');
      return ok(`## Graph Overview\n\nEntities: ${filtered.length} | Relations: ${relations.length}\n\n### Types\n${dist}`);
    }
    if (detailLevel === 'entity-list') {
      const lines = filtered.map(e => fmtEntity(e, 'name-only'));
      return ok(truncate(`## Entity List (${filtered.length})\n\n${lines.join('\n')}`));
    }
    // detail mode
    const blocks = filtered.map(e => fmtEntity(e));
    return ok(truncate(`## Graph Detail (${filtered.length} entities)\n\n${blocks.join('\n\n')}`));
  });

  log('memory-module: 10 tools registered');
}
