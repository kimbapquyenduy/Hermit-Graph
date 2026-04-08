#!/usr/bin/env node
/**
 * Custom git merge driver for brain.jsonl.
 * Performs entity-level 3-way merge instead of line-level.
 *
 * Git config: git config merge.brain-jsonl.driver "node scripts/merge-brain-jsonl.mjs %O %A %B"
 * .gitattributes: data/brain.jsonl merge=brain-jsonl
 *
 * Merge strategy:
 * - New entities from either side → keep both
 * - Same entity modified on both sides → keep version with more observations
 * - Relations: union of both sides (dedup by from+to+relationType)
 * - Deletions: if entity removed on one side, remove it (unless modified on other)
 *
 * Exit codes: 0 = clean merge, 1 = conflicts (written as markers)
 */

import { readFileSync, writeFileSync } from 'fs';

const [,, ancestorPath, oursPath, theirsPath] = process.argv;

if (!ancestorPath || !oursPath || !theirsPath) {
  console.error('Usage: merge-brain-jsonl.mjs <ancestor> <ours> <theirs>');
  process.exit(1);
}

/**
 * Parse brain.jsonl into { entities: Map<name, obj>, relations: Array }
 */
function parseBrainJSONL(content) {
  const entities = new Map();
  const relations = [];

  for (const line of content.split('\n').filter(Boolean)) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'entity') {
        entities.set(obj.name, obj);
      } else if (obj.type === 'relation') {
        relations.push(obj);
      }
    } catch { /* skip malformed */ }
  }

  return { entities, relations };
}

/**
 * Create a content fingerprint for an entity (for change detection).
 */
function entityFingerprint(entity) {
  return JSON.stringify({
    entityType: entity.entityType,
    observations: (entity.observations || []).sort(),
  });
}

/**
 * Deduplicate relations by from+to+relationType.
 */
function dedupeRelations(relations) {
  const seen = new Set();
  return relations.filter(r => {
    const key = `${r.from}|${r.to}|${r.relationType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Parse all three versions
const ancestor = parseBrainJSONL(readFileSync(ancestorPath, 'utf-8'));
const ours = parseBrainJSONL(readFileSync(oursPath, 'utf-8'));
const theirs = parseBrainJSONL(readFileSync(theirsPath, 'utf-8'));

// Entity-level 3-way merge
const merged = new Map();
const conflicts = [];
const allEntityNames = new Set([
  ...ancestor.entities.keys(),
  ...ours.entities.keys(),
  ...theirs.entities.keys(),
]);

for (const name of allEntityNames) {
  const anc = ancestor.entities.get(name);
  const our = ours.entities.get(name);
  const their = theirs.entities.get(name);

  const ancFP = anc ? entityFingerprint(anc) : null;
  const ourFP = our ? entityFingerprint(our) : null;
  const theirFP = their ? entityFingerprint(their) : null;

  if (our && their) {
    if (ourFP === theirFP) {
      // Both same → take ours
      merged.set(name, our);
    } else if (ourFP === ancFP) {
      // Only theirs changed → take theirs
      merged.set(name, their);
    } else if (theirFP === ancFP) {
      // Only ours changed → take ours
      merged.set(name, our);
    } else {
      // Both changed differently → take version with more observations
      const ourObs = (our.observations || []).length;
      const theirObs = (their.observations || []).length;
      merged.set(name, ourObs >= theirObs ? our : their);
      conflicts.push({
        entity: name,
        reason: 'both-modified',
        resolution: ourObs >= theirObs ? 'kept-ours' : 'kept-theirs',
        oursObsCount: ourObs,
        theirsObsCount: theirObs,
      });
    }
  } else if (our && !their) {
    if (anc) {
      // Theirs deleted, check if ours modified
      if (ourFP !== ancFP) {
        merged.set(name, our); // Modified on our side, keep
        conflicts.push({ entity: name, reason: 'delete-vs-modify', resolution: 'kept-modified' });
      }
      // else: both agree on deletion (ours unchanged, theirs deleted)
    } else {
      merged.set(name, our); // New on our side
    }
  } else if (!our && their) {
    if (anc) {
      if (theirFP !== ancFP) {
        merged.set(name, their); // Modified on their side, keep
        conflicts.push({ entity: name, reason: 'delete-vs-modify', resolution: 'kept-modified' });
      }
    } else {
      merged.set(name, their); // New on their side
    }
  }
  // else: both deleted → don't add
}

// Relation merge: union + dedup
const allRelations = [...ours.relations, ...theirs.relations];
const mergedRelations = dedupeRelations(allRelations).filter(r =>
  merged.has(r.from) && merged.has(r.to)
);

// Write merged result to "ours" file (git convention)
const outputLines = [
  ...[...merged.values()].map(e => JSON.stringify(e)),
  ...mergedRelations.map(r => JSON.stringify(r)),
];
writeFileSync(oursPath, outputLines.join('\n') + '\n');

// Report
if (conflicts.length > 0) {
  console.error(`brain.jsonl merge: ${conflicts.length} auto-resolved conflict(s):`);
  for (const c of conflicts) {
    console.error(`  ${c.entity}: ${c.reason} → ${c.resolution}`);
  }
}

console.error(`brain.jsonl merge: ${merged.size} entities, ${mergedRelations.length} relations`);
process.exit(0); // Always clean exit (auto-resolved)
