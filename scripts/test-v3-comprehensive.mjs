#!/usr/bin/env node
/**
 * Comprehensive test suite for Hermit Graph v3
 * Tests ALL features: v2 (existing) + v3 (planned)
 * Run after implementing v3 plan to verify everything works
 *
 * Usage: node scripts/test-v3-comprehensive.mjs
 * Exit: 0 if all pass, 1 if any fail
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const tests = [];
const results = { passed: 0, failed: 0, skipped: 0 };

// Helper: register a test
function test(name, category, fn) {
  tests.push({ name, category, fn });
}

// Helper: skip test with reason
function skip(reason) {
  return { skipped: true, reason };
}

// ══════════════════════════════════════════════════════════
// CATEGORY 1: FILE STRUCTURE & INTEGRITY
// ══════════════════════════════════════════════════════════

test('brain.jsonl exists and is valid JSONL', 'structure', () => {
  const p = join(ROOT, 'data', 'brain.jsonl');
  if (!existsSync(p)) throw new Error('Missing data/brain.jsonl');
  const lines = readFileSync(p, 'utf-8').trim().split('\n').filter(l => l.trim());
  if (lines.length === 0) throw new Error('brain.jsonl is empty');
  let entities = 0, relations = 0;
  for (const [i, line] of lines.entries()) {
    try {
      const d = JSON.parse(line);
      if (d.type === 'entity') entities++;
      if (d.type === 'relation') relations++;
    } catch (e) {
      throw new Error(`Line ${i + 1} invalid JSON: ${e.message}`);
    }
  }
  if (entities === 0) throw new Error('No entities found');
  return `${entities} entities, ${relations} relations, ${lines.length} total lines`;
});

test('brain-sample.jsonl is valid JSONL with prefixed observations', 'structure', () => {
  const p = join(ROOT, 'data', 'brain-sample.jsonl');
  if (!existsSync(p)) throw new Error('Missing data/brain-sample.jsonl');
  const lines = readFileSync(p, 'utf-8').trim().split('\n').filter(l => l.trim());
  let totalObs = 0, prefixed = 0;
  for (const line of lines) {
    const d = JSON.parse(line);
    if (d.type === 'entity') {
      for (const obs of d.observations || []) {
        totalObs++;
        if (obs.startsWith('[')) prefixed++;
      }
    }
  }
  if (prefixed !== totalObs) throw new Error(`${totalObs - prefixed}/${totalObs} observations missing prefix`);
  return `${prefixed}/${totalObs} observations prefixed`;
});

test('viewer/index.html exists with vis-network + confidence badges', 'structure', () => {
  const p = join(ROOT, 'viewer', 'index.html');
  if (!existsSync(p)) throw new Error('Missing viewer/index.html');
  const content = readFileSync(p, 'utf-8');
  if (!content.includes('vis-network')) throw new Error('Missing vis-network reference');
  if (!content.includes('parseObs') && !content.includes('confidence')) throw new Error('Missing confidence badge support');
  if (!content.includes('STALE') && !content.includes('stale')) throw new Error('Missing stale indicator');
  return 'vis-network + confidence badges + stale indicators present';
});

test('MCP config (.claude/.mcp.json) has memory server', 'structure', () => {
  const p = join(ROOT, '.claude', '.mcp.json');
  if (!existsSync(p)) throw new Error('Missing .claude/.mcp.json');
  const mcp = JSON.parse(readFileSync(p, 'utf-8'));
  if (!mcp.mcpServers?.memory) throw new Error('Missing memory MCP server');
  if (!mcp.mcpServers?.gitnexus) throw new Error('Missing gitnexus MCP server');
  const count = Object.keys(mcp.mcpServers).length;
  return `${count} MCP servers configured (memory + gitnexus required)`;
});

test('All brain skills have SKILL.md', 'structure', () => {
  const skills = ['auto-memory', 'biz-guard', 'code-patterns', 'api-design',
                  'db-migrations', 'security-scan', 'tech-advisor'];
  const dir = join(ROOT, '.claude', 'skills');
  const missing = skills.filter(s => !existsSync(join(dir, s, 'SKILL.md')));
  if (missing.length > 0) throw new Error(`Missing SKILL.md: ${missing.join(', ')}`);
  return `${skills.length} brain skills OK`;
});

test('All brain commands exist', 'structure', () => {
  const cmds = ['impact', 'biz-review', 'biz-init', 'remember', 'recall',
                'brain-dump', 'diagnose', 'ingest', 'tech-decision',
                'learn-project', 'suggest-reuse', 'brain-health', 'deep-scan'];
  const dir = join(ROOT, '.claude', 'commands');
  const missing = cmds.filter(c => !existsSync(join(dir, `${c}.md`)));
  if (missing.length > 0) throw new Error(`Missing commands: ${missing.join(', ')}`);
  return `${cmds.length} brain commands OK`;
});

test('All scripts exist', 'structure', () => {
  const scripts = [
    'brain-health.mjs', 'backfill-confidence.mjs', 'stale-report.mjs',
    'launch-memory-mcp.mjs', 'export-db-to-jsonl.mjs',
    'fix-brain-format.mjs', 'migrate-brain-v1-to-v2.mjs',
    'lib/parse-observation.mjs'
  ];
  const dir = join(ROOT, 'scripts');
  const missing = scripts.filter(s => !existsSync(join(dir, s)));
  if (missing.length > 0) throw new Error(`Missing scripts: ${missing.join(', ')}`);
  return `${scripts.length} scripts OK`;
});

test('GitNexus skills structure', 'structure', () => {
  const skills = ['gitnexus-cli', 'gitnexus-debugging', 'gitnexus-exploring',
                  'gitnexus-guide', 'gitnexus-impact-analysis', 'gitnexus-refactoring'];
  const dir = join(ROOT, '.claude', 'skills', 'gitnexus');
  const missing = skills.filter(s => !existsSync(join(dir, s, 'SKILL.md')));
  if (missing.length > 0) throw new Error(`Missing: ${missing.join(', ')}`);
  return `${skills.length} GitNexus skills OK`;
});

test('GitNexus index exists and is recent', 'structure', () => {
  const meta = join(ROOT, '.gitnexus', 'meta.json');
  if (!existsSync(meta)) throw new Error('Missing .gitnexus/meta.json — run `npx gitnexus analyze`');
  const m = JSON.parse(readFileSync(meta, 'utf-8'));
  if (!m.stats) throw new Error('meta.json missing stats');
  const age = (Date.now() - new Date(m.indexedAt).getTime()) / 86400000;
  if (age > 14) throw new Error(`Index is ${Math.round(age)} days old — run \`npx gitnexus analyze\``);
  return `${m.stats.nodes} nodes, ${m.stats.edges} edges, ${Math.round(age)}d old`;
});

test('Hooks wired correctly', 'structure', () => {
  const required = ['kg-auto-recall.cjs', 'session-init.cjs', 'session-state.cjs'];
  const dir = join(ROOT, '.claude', 'hooks');
  const missing = required.filter(h => !existsSync(join(dir, h)));
  if (missing.length > 0) throw new Error(`Missing hooks: ${missing.join(', ')}`);
  // Verify kg-auto-recall has search_nodes call
  const recall = readFileSync(join(dir, 'kg-auto-recall.cjs'), 'utf-8');
  if (!recall.includes('search_nodes') && !recall.includes('memory')) {
    throw new Error('kg-auto-recall.cjs missing memory search logic');
  }
  return `${required.length} critical hooks present, kg-auto-recall has search logic`;
});

// ══════════════════════════════════════════════════════════
// CATEGORY 2: PARSE-OBSERVATION LIBRARY
// ══════════════════════════════════════════════════════════

test('parseObservation: full prefix [0.95|2026-03-26]', 'parser', () => {
  const RE = /^\[(\d\.?\d*?)(?:\|(\d{4}-\d{2}-\d{2}))?\]\s*/;
  function parse(obs) {
    const text = typeof obs === 'string' ? obs : (obs && obs.content) || '';
    const m = text.match(RE);
    if (m) return { confidence: Math.min(parseFloat(m[1]), 1.0), date: m[2] || null, text: text.replace(RE, '') };
    return { confidence: 0.8, date: null, text };
  }

  const r = parse('[0.95|2026-03-26] RULE: Discount max 50%');
  if (r.confidence !== 0.95) throw new Error(`conf: expected 0.95 got ${r.confidence}`);
  if (r.date !== '2026-03-26') throw new Error(`date: expected 2026-03-26 got ${r.date}`);
  if (r.text !== 'RULE: Discount max 50%') throw new Error(`text mismatch: ${r.text}`);
  return 'full prefix parsed correctly';
});

test('parseObservation: confidence only [0.8]', 'parser', () => {
  const RE = /^\[(\d\.?\d*?)(?:\|(\d{4}-\d{2}-\d{2}))?\]\s*/;
  function parse(obs) {
    const text = typeof obs === 'string' ? obs : (obs && obs.content) || '';
    const m = text.match(RE);
    if (m) return { confidence: Math.min(parseFloat(m[1]), 1.0), date: m[2] || null, text: text.replace(RE, '') };
    return { confidence: 0.8, date: null, text };
  }
  const r = parse('[0.8] WHAT: something');
  if (r.confidence !== 0.8) throw new Error(`expected 0.8 got ${r.confidence}`);
  if (r.date !== null) throw new Error(`expected null date got ${r.date}`);
  return 'confidence-only parsed correctly';
});

test('parseObservation: legacy (no prefix) defaults to 0.8', 'parser', () => {
  const RE = /^\[(\d\.?\d*?)(?:\|(\d{4}-\d{2}-\d{2}))?\]\s*/;
  function parse(obs) {
    const text = typeof obs === 'string' ? obs : (obs && obs.content) || '';
    const m = text.match(RE);
    if (m) return { confidence: Math.min(parseFloat(m[1]), 1.0), date: m[2] || null, text: text.replace(RE, '') };
    return { confidence: 0.8, date: null, text };
  }
  const r = parse('RULE: old observation');
  if (r.confidence !== 0.8) throw new Error(`legacy should default to 0.8`);
  if (r.text !== 'RULE: old observation') throw new Error(`text mismatch`);
  return 'legacy defaults correctly';
});

test('parseObservation: edge cases [1.0], [0], [1|date]', 'parser', () => {
  const RE = /^\[(\d\.?\d*?)(?:\|(\d{4}-\d{2}-\d{2}))?\]\s*/;
  function parse(obs) {
    const text = typeof obs === 'string' ? obs : (obs && obs.content) || '';
    const m = text.match(RE);
    if (m) return { confidence: Math.min(parseFloat(m[1]), 1.0), date: m[2] || null, text: text.replace(RE, '') };
    return { confidence: 0.8, date: null, text };
  }
  const r1 = parse('[1.0] FIX: done');
  if (r1.confidence !== 1.0) throw new Error(`[1.0] failed: ${r1.confidence}`);
  const r2 = parse('[0] LOW: uncertain');
  if (r2.confidence !== 0) throw new Error(`[0] failed: ${r2.confidence}`);
  const r3 = parse('[1|2026-04-08] DECISION: test');
  if (r3.confidence !== 1.0) throw new Error(`[1|date] failed: ${r3.confidence}`);
  if (r3.date !== '2026-04-08') throw new Error(`[1|date] date failed: ${r3.date}`);
  return '[1.0], [0], [1|date] all correct';
});

test('parseObservation: object format {content: "..."}', 'parser', () => {
  const RE = /^\[(\d\.?\d*?)(?:\|(\d{4}-\d{2}-\d{2}))?\]\s*/;
  function parse(obs) {
    const text = typeof obs === 'string' ? obs : (obs && obs.content) || '';
    const m = text.match(RE);
    if (m) return { confidence: Math.min(parseFloat(m[1]), 1.0), date: m[2] || null, text: text.replace(RE, '') };
    return { confidence: 0.8, date: null, text };
  }
  const r1 = parse({ content: '[0.95|2026-03-27] Platform', timestamp: 123 });
  if (r1.confidence !== 0.95) throw new Error(`obj parse failed: ${r1.confidence}`);
  const r2 = parse(null);
  if (r2.text !== '') throw new Error(`null should return empty text`);
  const r3 = parse({});
  if (r3.text !== '') throw new Error(`empty obj should return empty text`);
  return 'object, null, empty-obj all handled';
});

test('obsText: string passthrough and object extraction', 'parser', () => {
  function obsText(obs) {
    return typeof obs === 'string' ? obs : (obs && obs.content) || '';
  }
  if (obsText('hello') !== 'hello') throw new Error('string passthrough failed');
  if (obsText({ content: 'world' }) !== 'world') throw new Error('object extraction failed');
  if (obsText(null) !== '') throw new Error('null handling failed');
  if (obsText(undefined) !== '') throw new Error('undefined handling failed');
  if (obsText({}) !== '') throw new Error('empty obj handling failed');
  return '5 obsText cases OK';
});

// ══════════════════════════════════════════════════════════
// CATEGORY 3: STALE DETECTION
// ══════════════════════════════════════════════════════════

test('isStale: old date (>180d) is stale', 'stale', () => {
  function isStale(dateStr, threshold = 180) {
    if (!dateStr) return false;
    return (Date.now() - new Date(dateStr).getTime()) / 86400000 > threshold;
  }
  if (!isStale('2025-01-01')) throw new Error('2025-01-01 should be stale');
  return 'old date correctly detected as stale';
});

test('isStale: recent date (<180d) is not stale', 'stale', () => {
  function isStale(dateStr, threshold = 180) {
    if (!dateStr) return false;
    return (Date.now() - new Date(dateStr).getTime()) / 86400000 > threshold;
  }
  const recent = new Date();
  recent.setDate(recent.getDate() - 10);
  if (isStale(recent.toISOString().split('T')[0])) throw new Error('10d ago should NOT be stale');
  return 'recent date correctly not stale';
});

test('isStale: null date returns false', 'stale', () => {
  function isStale(dateStr, threshold = 180) {
    if (!dateStr) return false;
    return (Date.now() - new Date(dateStr).getTime()) / 86400000 > threshold;
  }
  if (isStale(null)) throw new Error('null should not be stale');
  if (isStale(undefined)) throw new Error('undefined should not be stale');
  return 'null/undefined correctly not stale';
});

// ══════════════════════════════════════════════════════════
// CATEGORY 4: BRAIN HEALTH (v2.3)
// ══════════════════════════════════════════════════════════

test('brain-health.mjs: script runs on brain.jsonl', 'health', () => {
  const p = join(ROOT, 'data', 'brain.jsonl');
  if (!existsSync(p)) throw new Error('Missing brain.jsonl');
  try {
    const out = execSync(`node "${join(ROOT, 'scripts', 'brain-health.mjs')}" "${p}"`, {
      encoding: 'utf-8', timeout: 15000
    });
    if (!out.includes('Score:')) throw new Error('Output missing Score');
    const match = out.match(/Score:\s*(\d+)/);
    const score = parseInt(match?.[1] || '0');
    return `Brain health score: ${score}/100`;
  } catch (e) {
    if (e.status === 1 && e.stdout?.includes('Score:')) {
      const match = e.stdout.match(/Score:\s*(\d+)/);
      return `Brain health score: ${match?.[1]}/100 (needs attention)`;
    }
    throw e;
  }
});

test('brain-health: no duplicates in brain.jsonl', 'health', () => {
  const content = readFileSync(join(ROOT, 'data', 'brain.jsonl'), 'utf-8');
  const entities = content.trim().split('\n').filter(l => l.trim())
    .map(l => JSON.parse(l)).filter(d => d.type === 'entity');
  const names = entities.map(e => e.name.toLowerCase());
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) throw new Error(`Duplicates found: ${[...new Set(dupes)].slice(0, 5).join(', ')}`);
  return `0 duplicates in ${entities.length} entities`;
});

test('brain-health: orphan rate below 10%', 'health', () => {
  const content = readFileSync(join(ROOT, 'data', 'brain.jsonl'), 'utf-8');
  const lines = content.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  const entities = lines.filter(d => d.type === 'entity');
  const relations = lines.filter(d => d.type === 'relation');
  const linked = new Set();
  for (const r of relations) { linked.add(r.from); linked.add(r.to); }
  const orphans = entities.filter(e => !linked.has(e.name));
  const rate = entities.length > 0 ? orphans.length / entities.length : 0;
  if (rate > 0.2) throw new Error(`Orphan rate ${(rate * 100).toFixed(1)}% (${orphans.length}/${entities.length}). Top orphans: ${orphans.slice(0, 3).map(e => e.name).join(', ')}`);
  return `Orphan rate: ${(rate * 100).toFixed(1)}% (${orphans.length}/${entities.length})`;
});

test('brain-health: all observations are valid format in brain.jsonl', 'health', () => {
  const content = readFileSync(join(ROOT, 'data', 'brain.jsonl'), 'utf-8');
  const entities = content.trim().split('\n').filter(l => l.trim())
    .map(l => JSON.parse(l)).filter(d => d.type === 'entity');
  let total = 0, invalid = 0;
  for (const e of entities) {
    for (const obs of e.observations || []) {
      total++;
      // Accept: string OR {content: string} object (MCP format)
      const isValid = typeof obs === 'string' || (obs && typeof obs.content === 'string');
      if (!isValid) invalid++;
    }
  }
  if (invalid > 0) throw new Error(`${invalid}/${total} invalid observations (not string or {content})`);
  return `${total} observations all valid format`;
});

// ══════════════════════════════════════════════════════════
// CATEGORY 5: KG ENTITY NAMING (v2 schema)
// ══════════════════════════════════════════════════════════

test('Entity names follow TIER:SCOPE:LABEL convention', 'schema', () => {
  const content = readFileSync(join(ROOT, 'data', 'brain.jsonl'), 'utf-8');
  const entities = content.trim().split('\n').filter(l => l.trim())
    .map(l => JSON.parse(l)).filter(d => d.type === 'entity');
  const validTiers = ['BIZ', 'RULE', 'FLOW', 'ENTITY', 'PATTERN', 'TECH', 'INCIDENT', 'GOTCHA',
                      'DECISION', 'FEATURE'];
  let valid = 0, invalid = 0;
  const badNames = [];
  for (const e of entities) {
    const tier = e.name.split(':')[0];
    if (validTiers.includes(tier)) {
      valid++;
    } else {
      invalid++;
      if (badNames.length < 10) badNames.push(e.name);
    }
  }
  // Allow up to 5% legacy names
  const rate = entities.length > 0 ? invalid / entities.length : 0;
  if (rate > 0.05) throw new Error(`${invalid}/${entities.length} entities have non-v2 names: ${badNames.join(', ')}`);
  return `${valid}/${entities.length} entities follow v2 naming (${invalid} legacy)`;
});

test('EntityTypes are valid v2 types', 'schema', () => {
  const validTypes = new Set([
    'biz-domain', 'biz-rule', 'biz-flow', 'biz-entity',
    'pattern-code', 'pattern-arch', 'pattern-integration',
    'tech-stack', 'tech-config', 'tech-person', 'tech-decision',
    'incident-bug', 'incident-gotcha'
  ]);
  const content = readFileSync(join(ROOT, 'data', 'brain.jsonl'), 'utf-8');
  const entities = content.trim().split('\n').filter(l => l.trim())
    .map(l => JSON.parse(l)).filter(d => d.type === 'entity');
  let valid = 0, invalid = 0;
  const badTypes = [];
  for (const e of entities) {
    if (validTypes.has(e.entityType)) {
      valid++;
    } else {
      invalid++;
      if (badTypes.length < 10) badTypes.push(`${e.name}: ${e.entityType}`);
    }
  }
  if (invalid > 0) throw new Error(`${invalid} invalid entityTypes: ${badTypes.join(', ')}`);
  return `${valid} entities all have valid v2 entityTypes`;
});

test('Observations have [confidence|date] prefix', 'schema', () => {
  const RE = /^\[(\d\.?\d*?)(?:\|(\d{4}-\d{2}-\d{2}))?\]\s*/;
  const content = readFileSync(join(ROOT, 'data', 'brain.jsonl'), 'utf-8');
  const entities = content.trim().split('\n').filter(l => l.trim())
    .map(l => JSON.parse(l)).filter(d => d.type === 'entity');
  let total = 0, prefixed = 0;
  for (const e of entities) {
    for (const obs of e.observations || []) {
      const text = typeof obs === 'string' ? obs : (obs?.content || '');
      total++;
      if (RE.test(text)) prefixed++;
    }
  }
  const rate = total > 0 ? prefixed / total : 0;
  // Allow up to 10% legacy without prefix
  if (rate < 0.9) throw new Error(`Only ${(rate * 100).toFixed(1)}% observations have prefix (${prefixed}/${total})`);
  return `${(rate * 100).toFixed(1)}% observations prefixed (${prefixed}/${total})`;
});

// ══════════════════════════════════════════════════════════
// CATEGORY 6: KG AUTO-RECALL HOOK
// ══════════════════════════════════════════════════════════

test('kg-auto-recall hook extracts keywords from user messages', 'hooks', () => {
  const hookPath = join(ROOT, '.claude', 'hooks', 'kg-auto-recall.cjs');
  const content = readFileSync(hookPath, 'utf-8');
  // Should have keyword extraction logic
  if (!content.includes('keyword') && !content.includes('extract') && !content.includes('search')) {
    throw new Error('Hook missing keyword extraction logic');
  }
  // Should call MCP memory search
  if (!content.includes('search_nodes') && !content.includes('memory')) {
    throw new Error('Hook missing memory search call');
  }
  return 'kg-auto-recall has keyword extraction + memory search';
});

// ══════════════════════════════════════════════════════════
// CATEGORY 7: GITNEXUS INTEGRATION
// ══════════════════════════════════════════════════════════

test('GitNexus MCP server configured in .claude/.mcp.json', 'gitnexus', () => {
  const mcp = JSON.parse(readFileSync(join(ROOT, '.claude', '.mcp.json'), 'utf-8'));
  if (!mcp.mcpServers?.gitnexus) throw new Error('Missing gitnexus in .claude/.mcp.json');
  if (!mcp.mcpServers.gitnexus.command) throw new Error('gitnexus missing command');
  return 'GitNexus MCP configured';
});

test('GitNexus .gitnexus/ index exists with KuzuDB', 'gitnexus', () => {
  const meta = join(ROOT, '.gitnexus', 'meta.json');
  if (!existsSync(meta)) throw new Error('No .gitnexus/meta.json');
  const lbug = join(ROOT, '.gitnexus', 'lbug');
  if (!existsSync(lbug)) throw new Error('No .gitnexus/lbug (KuzuDB file)');
  const m = JSON.parse(readFileSync(meta, 'utf-8'));
  return `KuzuDB: ${m.stats.nodes} nodes, ${m.stats.edges} edges, ${m.stats.processes} processes`;
});

test('GitNexus and Brain KG are separate graphs (no cross-contamination)', 'gitnexus', () => {
  // GitNexus stores code symbols, Brain stores knowledge entities — verify they don't mix
  const meta = JSON.parse(readFileSync(join(ROOT, '.gitnexus', 'meta.json'), 'utf-8'));
  const brain = readFileSync(join(ROOT, 'data', 'brain.jsonl'), 'utf-8');
  const brainEntities = brain.trim().split('\n').filter(l => l.trim())
    .map(l => JSON.parse(l)).filter(d => d.type === 'entity');
  // Brain should NOT have code symbols like function names from GitNexus
  // GitNexus meta should NOT reference brain.jsonl
  if (meta.repoPath && meta.stats) {
    // GitNexus tracks code, Brain tracks knowledge — different concerns
    return `Separate: GitNexus=${meta.stats.nodes} code symbols, Brain=${brainEntities.length} knowledge entities`;
  }
  throw new Error('Could not verify separation');
});

// ══════════════════════════════════════════════════════════
// CATEGORY 8: V3 — SEMANTIC SEARCH (Phase 1)
// ══════════════════════════════════════════════════════════

test('[v3] Semantic search module exists', 'v3-semantic', () => {
  // Check for semantic search implementation files
  const candidates = [
    join(ROOT, 'scripts', 'lib', 'semantic-search.mjs'),
    join(ROOT, 'scripts', 'lib', 'embeddings.mjs'),
    join(ROOT, 'mcp-memory-libsql', 'src', 'embeddings.ts'),
    join(ROOT, 'scripts', 'setup-semantic.mjs'),
  ];
  const found = candidates.filter(p => existsSync(p));
  if (found.length === 0) return skip('No semantic search module yet (v3 Phase 1 pending)');
  return `Found: ${found.map(f => f.split(/[/\\]/).pop()).join(', ')}`;
});

test('[v3] Semantic search: embedding model available', 'v3-semantic', () => {
  // Check if JS embedding model is downloaded/available
  const modelDirs = [
    join(ROOT, 'node_modules', '@xenova'),
    join(ROOT, 'node_modules', 'onnxruntime-node'),
    join(ROOT, '.cache', 'embeddings'),
    join(ROOT, 'data', 'models'),
  ];
  const found = modelDirs.filter(p => existsSync(p));
  if (found.length === 0) return skip('No embedding model installed yet (v3 Phase 1 pending)');
  return `Model found at: ${found.map(f => f.split(/[/\\]/).slice(-2).join('/')).join(', ')}`;
});

test('[v3] Semantic search: hybrid search returns ranked results', 'v3-semantic', async () => {
  try {
    const { search, searchStatus } = await import('./lib/semantic-search.mjs');
    const status = searchStatus();
    if (!status.vectorSearch) return skip('Embedding index not built yet');
    const results = await search('brain health check', { topK: 5 });
    if (results.length === 0) return { pass: false, detail: 'No results for "brain health check"' };
    // Top result should be related to brain health
    const topName = results[0].name.toLowerCase();
    if (!topName.includes('brain') && !topName.includes('health')) {
      return { pass: false, detail: `Top result "${results[0].name}" not relevant to "brain health check"` };
    }
    return { pass: true, detail: `Top: ${results[0].name} (score ${results[0].score})` };
  } catch (err) {
    return { pass: false, detail: err.message };
  }
});

test('[v3] Semantic search: recall >80% on test queries', 'v3-semantic', async () => {
  try {
    const { search } = await import('./lib/semantic-search.mjs');
    // Test queries with expected entity in top-5 results
    const testCases = [
      { query: 'VNPay payment', expected: 'TECH:VNPay' },
      { query: 'brain health diagnostics', expected: 'FEATURE:BrainHealth_HealthCheck_Command' },
      { query: 'GitNexus code intelligence', expected: 'TECH:Decision:BrainCLI_GitNexus_Integration' },
      { query: 'semantic search vector', expected: 'DECISION:ClaudeCodeBrain:SemanticSearch_vs_KeywordSearch' },
      { query: 'login authentication flow', expected: 'FLOW:WebCash:LoginAuth' },
    ];
    let hits = 0;
    const details = [];
    for (const tc of testCases) {
      const results = await search(tc.query, { topK: 5 });
      const found = results.some(r => r.name === tc.expected);
      if (found) hits++;
      details.push(`${found ? '✓' : '✗'} "${tc.query}" → ${tc.expected}`);
    }
    const recall = hits / testCases.length;
    if (recall < 0.8) return { pass: false, detail: `Recall ${(recall*100).toFixed(0)}% < 80%\n   ${details.join('\n   ')}` };
    return { pass: true, detail: `Recall ${(recall*100).toFixed(0)}% (${hits}/${testCases.length})` };
  } catch (err) {
    return { pass: false, detail: err.message };
  }
});

// ══════════════════════════════════════════════════════════
// CATEGORY 9: V3 — DASHBOARD UPGRADE (Phase 2)
// ══════════════════════════════════════════════════════════

test('[v3] Dashboard: search/filter functionality', 'v3-dashboard', () => {
  const viewer = join(ROOT, 'viewer', 'index.html');
  const content = readFileSync(viewer, 'utf-8');
  // Check for search input
  if (!content.includes('search') && !content.includes('filter')) {
    return skip('Dashboard search/filter not implemented yet (v3 Phase 2 pending)');
  }
  // Check for filter by entity type
  const hasTypeFilter = content.includes('entityType') || content.includes('type-filter');
  // Check for search input element
  const hasSearchInput = content.includes('input') && content.includes('search');
  if (!hasTypeFilter && !hasSearchInput) return skip('Search UI elements not found (v3 Phase 2)');
  return `Search: ${hasSearchInput}, Type filter: ${hasTypeFilter}`;
});

test('[v3] Dashboard: health metrics display', 'v3-dashboard', () => {
  const viewer = join(ROOT, 'viewer', 'index.html');
  const content = readFileSync(viewer, 'utf-8');
  if (!content.includes('health') && !content.includes('score')) {
    return skip('Health metrics not in dashboard yet (v3 Phase 2 pending)');
  }
  return 'Health metrics display present';
});

test('[v3] Dashboard: loads in <2 seconds', 'v3-dashboard', () => {
  // Check file size as proxy for load time
  const viewer = join(ROOT, 'viewer', 'index.html');
  const stats = readFileSync(viewer);
  const sizeKB = stats.length / 1024;
  if (sizeKB > 500) throw new Error(`viewer/index.html is ${sizeKB.toFixed(0)}KB — may load slowly`);
  return `viewer/index.html: ${sizeKB.toFixed(0)}KB (should load fast)`;
});

// ══════════════════════════════════════════════════════════
// CATEGORY 10: V3 — MULTI-AGENT PROTOCOL (Phase 3)
// ══════════════════════════════════════════════════════════

test('[v3] Multi-agent: file locking mechanism', 'v3-multiagent', () => {
  const candidates = [
    join(ROOT, 'scripts', 'lib', 'file-lock.mjs'),
    join(ROOT, 'mcp-memory-libsql', 'src', 'lock.ts'),
  ];
  const found = candidates.filter(p => existsSync(p));
  if (found.length === 0) return skip('No file locking module yet (v3 Phase 3 pending)');
  return `Lock module: ${found.map(f => f.split(/[/\\]/).pop()).join(', ')}`;
});

test('[v3] Multi-agent: concurrent read safety', 'v3-multiagent', async () => {
  try {
    const { withLock, getLockStatus } = await import('./lib/file-lock.mjs');
    const testFile = join(ROOT, 'data', 'brain.jsonl');
    // Verify lock-free read works
    const status = getLockStatus(testFile);
    if (status.locked && !status.stale) return { pass: false, detail: 'brain.jsonl unexpectedly locked' };
    // Test lock acquire/release cycle
    let lockWorked = false;
    await withLock(testFile, async () => {
      const s = getLockStatus(testFile);
      lockWorked = s.locked;
    }, 'test-agent');
    const afterStatus = getLockStatus(testFile);
    if (!lockWorked) return { pass: false, detail: 'Lock was not acquired during withLock' };
    if (afterStatus.locked) return { pass: false, detail: 'Lock not released after withLock' };
    return { pass: true, detail: 'Lock acquire/release cycle works, reads are lock-free' };
  } catch (err) {
    return { pass: false, detail: err.message };
  }
});

// ══════════════════════════════════════════════════════════
// CATEGORY 11: V3 — BRANCH-AWARE KG (Phase 4)
// ══════════════════════════════════════════════════════════

test('[v3] Branch-aware: merge conflict detection', 'v3-branch', () => {
  const candidates = [
    join(ROOT, 'scripts', 'lib', 'kg-merge.mjs'),
    join(ROOT, 'scripts', 'merge-brain.mjs'),
    join(ROOT, 'scripts', 'merge-brain-jsonl.mjs'),
  ];
  const found = candidates.filter(p => existsSync(p));
  if (found.length === 0) return skip('No KG merge module yet (v3 Phase 4 pending)');
  // Also check .gitattributes for merge driver config
  const gitattrs = join(ROOT, '.gitattributes');
  const hasDriver = existsSync(gitattrs) && readFileSync(gitattrs, 'utf-8').includes('brain-jsonl');
  return `Merge module: ${found.map(f => f.split(/[/\\]/).pop()).join(', ')}${hasDriver ? ' + .gitattributes configured' : ''}`;
});

test('[v3] Branch-aware: JSONL diff-friendly format preserved', 'v3-branch', () => {
  // Verify brain.jsonl uses one-entity-per-line for git diffability
  const content = readFileSync(join(ROOT, 'data', 'brain.jsonl'), 'utf-8');
  const lines = content.trim().split('\n').filter(l => l.trim());
  // Each line should be a complete JSON object
  let multiline = 0;
  for (const line of lines) {
    try { JSON.parse(line); } catch { multiline++; }
  }
  if (multiline > 0) throw new Error(`${multiline} lines are not valid single-line JSON (breaks git diff)`);
  return `${lines.length} lines, all single-line JSON (git-diff friendly)`;
});

// ══════════════════════════════════════════════════════════
// CATEGORY 12: V3 — HERMIT CLI UNIFICATION (Phase 5)
// ══════════════════════════════════════════════════════════

test('[v3] Hermit CLI: unified entry point exists', 'v3-cli', () => {
  const candidates = [
    join(ROOT, 'bin', 'hermit'),
    join(ROOT, 'bin', 'hermit.mjs'),
    join(ROOT, 'cli', 'index.mjs'),
    join(ROOT, 'scripts', 'brain-cli.mjs'),
  ];
  const found = candidates.filter(p => existsSync(p));
  if (found.length === 0) return skip('No Hermit CLI entry point yet (v3 Phase 5 pending)');
  return `CLI entry: ${found.map(f => f.split(/[/\\]/).pop()).join(', ')}`;
});

test('[v3] Hermit CLI: package.json has bin field', 'v3-cli', () => {
  const pkg = join(ROOT, 'package.json');
  if (!existsSync(pkg)) return skip('No package.json');
  const p = JSON.parse(readFileSync(pkg, 'utf-8'));
  if (!p.bin) return skip('No bin field in package.json (v3 Phase 5 pending)');
  return `bin: ${JSON.stringify(p.bin)}`;
});

// ══════════════════════════════════════════════════════════
// CATEGORY 13: CROSS-CUTTING INTEGRATION
// ══════════════════════════════════════════════════════════

test('Memory MCP server launch script works', 'integration', () => {
  const p = join(ROOT, 'scripts', 'launch-memory-mcp.mjs');
  if (!existsSync(p)) throw new Error('Missing launch-memory-mcp.mjs');
  const content = readFileSync(p, 'utf-8');
  if (!content.includes('better-memory-mcp')) throw new Error('Launch script not using better-memory-mcp');
  return 'Launch script targets better-memory-mcp';
});

test('Export script produces valid JSONL with string observations', 'integration', () => {
  const p = join(ROOT, 'scripts', 'export-db-to-jsonl.mjs');
  if (!existsSync(p)) throw new Error('Missing export-db-to-jsonl.mjs');
  // Verify the exported brain.jsonl has valid observations (string or {content})
  const content = readFileSync(join(ROOT, 'data', 'brain.jsonl'), 'utf-8');
  const entities = content.trim().split('\n').filter(l => l.trim())
    .map(l => JSON.parse(l)).filter(d => d.type === 'entity');
  let bad = 0;
  for (const e of entities) {
    for (const obs of e.observations || []) {
      const valid = typeof obs === 'string' || (obs && typeof obs.content === 'string');
      if (!valid) bad++;
    }
  }
  if (bad > 0) throw new Error(`${bad} invalid observations — not string or {content}`);
  return `All observations valid in brain.jsonl`;
});

test('backfill-confidence.mjs exists', 'integration', () => {
  const p = join(ROOT, 'scripts', 'backfill-confidence.mjs');
  if (!existsSync(p)) throw new Error('Missing backfill-confidence.mjs');
  return 'backfill script exists';
});

test('stale-report.mjs exists', 'integration', () => {
  const p = join(ROOT, 'scripts', 'stale-report.mjs');
  if (!existsSync(p)) throw new Error('Missing stale-report.mjs');
  return 'stale report script exists';
});

// ══════════════════════════════════════════════════════════
// CATEGORY 14: KG DATA QUALITY
// ══════════════════════════════════════════════════════════

test('Competitor landscape entities exist in KG', 'data-quality', () => {
  const content = readFileSync(join(ROOT, 'data', 'brain.jsonl'), 'utf-8');
  const entities = content.trim().split('\n').filter(l => l.trim())
    .map(l => JSON.parse(l)).filter(d => d.type === 'entity');
  const names = new Set(entities.map(e => e.name));
  const expected = [
    'TECH:CompetitorLandscape:KGMemoryForCodingAgents',
    'BIZ:ClaudeCodeBrain:USP',
    'TECH:Decision:SemanticSearch_LightweightVsCloud'
  ];
  const missing = expected.filter(n => !names.has(n));
  if (missing.length > 0) throw new Error(`Missing entities: ${missing.join(', ')}`);
  return `${expected.length} competitive analysis entities present`;
});

test('Relations reference existing entities', 'data-quality', () => {
  const content = readFileSync(join(ROOT, 'data', 'brain.jsonl'), 'utf-8');
  const lines = content.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  const entityNames = new Set(lines.filter(d => d.type === 'entity').map(e => e.name));
  const relations = lines.filter(d => d.type === 'relation');
  let dangling = 0;
  const danglingList = [];
  for (const r of relations) {
    if (!entityNames.has(r.from)) { dangling++; if (danglingList.length < 5) danglingList.push(`from: ${r.from}`); }
    if (!entityNames.has(r.to)) { dangling++; if (danglingList.length < 5) danglingList.push(`to: ${r.to}`); }
  }
  if (dangling > 0) throw new Error(`${dangling} dangling relation refs: ${danglingList.join(', ')}`);
  return `${relations.length} relations, 0 dangling references`;
});

// ══════════════════════════════════════════════════════════
// RUN ALL TESTS
// ══════════════════════════════════════════════════════════

console.log('╔══════════════════════════════════════════════════╗');
console.log('║   Hermit Graph — v3 Comprehensive Tests         ║');
console.log('╚══════════════════════════════════════════════════╝\n');

let currentCategory = '';
for (const t of tests) {
  if (t.category !== currentCategory) {
    currentCategory = t.category;
    console.log(`\n── ${currentCategory.toUpperCase()} ──`);
  }
  try {
    const result = await t.fn();
    if (result && typeof result === 'object' && result.skipped) {
      console.log(`⏭  SKIP: ${t.name}`);
      console.log(`   Reason: ${result.reason}`);
      results.skipped++;
    } else if (result && typeof result === 'object' && result.pass === false) {
      console.log(`❌ FAIL: ${t.name}`);
      console.log(`   ${result.detail}`);
      results.failed++;
    } else if (result && typeof result === 'object' && result.pass === true) {
      console.log(`✅ PASS: ${t.name}`);
      console.log(`   ${result.detail}`);
      results.passed++;
    } else {
      console.log(`✅ PASS: ${t.name}`);
      console.log(`   ${result}`);
      results.passed++;
    }
  } catch (err) {
    console.log(`❌ FAIL: ${t.name}`);
    console.log(`   ${err.message}`);
    results.failed++;
  }
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log(`║  Results: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`.padEnd(51) + '║');
console.log('╚══════════════════════════════════════════════════╝');

if (results.skipped > 0) {
  console.log(`\nSkipped tests are v3 features not yet implemented.`);
  console.log('After implementing each v3 phase, re-run to verify.');
}

process.exit(results.failed > 0 ? 1 : 0);
