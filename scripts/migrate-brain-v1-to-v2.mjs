import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');
const BRAIN_FILE = join(DATA_DIR, 'brain.jsonl');
const BACKUP_FILE = join(DATA_DIR, 'brain-v1-backup.jsonl');

// EntityType mapping: old → { newType, prefix }
const TYPE_MAP = {
  'project':              { newType: 'biz-domain',          prefix: 'BIZ:' },
  'Project':              { newType: 'biz-domain',          prefix: 'BIZ:' },
  'person':               { newType: 'tech-person',         prefix: 'PERSON:' },
  'service':              { newType: 'tech-stack',           prefix: 'TECH:' },
  'Service':              { newType: 'tech-stack',           prefix: 'TECH:' },
  'technology':           { newType: 'tech-stack',           prefix: 'TECH:' },
  'pattern':              { newType: 'pattern-code',         prefix: 'PATTERN:' },
  'ERPSystem':            { newType: 'biz-domain',           prefix: 'BIZ:' },
  'ERPModule':            { newType: 'biz-entity',           prefix: 'ENTITY:' },
  'BusinessFlow':         { newType: 'biz-flow',             prefix: 'FLOW:' },
  'Architecture':         { newType: 'pattern-arch',         prefix: 'PATTERN:ARCH:' },
  'ExternalIntegration':  { newType: 'pattern-integration',  prefix: 'PATTERN:INT:' },
  'Company':              { newType: 'biz-domain',           prefix: 'BIZ:' },
  'DataModel':            { newType: 'biz-entity',           prefix: 'ENTITY:' },
  'config':               { newType: 'tech-config',          prefix: 'CONFIG:' },
  'decision':             { newType: 'tech-decision',        prefix: 'DECISION:' },
  'lesson':               { newType: 'incident-gotcha',      prefix: 'GOTCHA:' },
};

// Known TIER prefixes — skip if already prefixed
const TIER_PREFIXES = ['BIZ:', 'RULE:', 'FLOW:', 'ENTITY:', 'PATTERN:', 'TECH:', 'PERSON:', 'INCIDENT:', 'GOTCHA:', 'DECISION:', 'CONFIG:', 'BUG:'];

function hasV2Prefix(name) {
  return TIER_PREFIXES.some(p => name.startsWith(p));
}

function migrate() {
  if (!existsSync(BRAIN_FILE)) {
    console.log('❌ No brain.jsonl found at', BRAIN_FILE);
    process.exit(1);
  }

  // Backup
  if (!existsSync(BACKUP_FILE)) {
    copyFileSync(BRAIN_FILE, BACKUP_FILE);
    console.log('📦 Backup created:', BACKUP_FILE);
  } else {
    console.log('📦 Backup already exists, skipping backup');
  }

  const lines = readFileSync(BRAIN_FILE, 'utf8').trim().split('\n');
  const entities = [];
  const relations = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'entity') entities.push(obj);
      else if (obj.type === 'relation') relations.push(obj);
    } catch (e) {
      console.warn('⚠️ Skipping invalid JSON line:', line.substring(0, 50));
    }
  }

  // Build name mapping: oldName → newName
  const nameMap = {};
  let migratedCount = 0;
  let skippedCount = 0;
  let unknownTypes = [];

  for (const entity of entities) {
    const oldName = entity.name;

    // Skip already-prefixed entities
    if (hasV2Prefix(oldName)) {
      nameMap[oldName] = oldName;
      skippedCount++;
      continue;
    }

    const mapping = TYPE_MAP[entity.entityType];
    if (!mapping) {
      unknownTypes.push(`${oldName} (${entity.entityType})`);
      nameMap[oldName] = oldName; // keep as-is
      continue;
    }

    const newName = mapping.prefix + oldName;
    entity.name = newName;
    entity.entityType = mapping.newType;
    nameMap[oldName] = newName;
    migratedCount++;
  }

  // Update relations
  let relationsUpdated = 0;
  for (const rel of relations) {
    let changed = false;
    if (nameMap[rel.from] && nameMap[rel.from] !== rel.from) {
      rel.from = nameMap[rel.from];
      changed = true;
    }
    if (nameMap[rel.to] && nameMap[rel.to] !== rel.to) {
      rel.to = nameMap[rel.to];
      changed = true;
    }
    if (changed) relationsUpdated++;
  }

  // Write output
  const output = [...entities, ...relations].map(obj => JSON.stringify(obj)).join('\n') + '\n';
  writeFileSync(BRAIN_FILE, output, 'utf8');

  // Summary
  console.log('\n🔄 Migration complete!');
  console.log(`   Entities migrated: ${migratedCount}`);
  console.log(`   Entities skipped (already v2): ${skippedCount}`);
  console.log(`   Relations updated: ${relationsUpdated}`);
  if (unknownTypes.length > 0) {
    console.log(`   ⚠️ Unknown types (kept as-is): ${unknownTypes.join(', ')}`);
  }
  console.log(`   Output: ${BRAIN_FILE}`);
}

migrate();
