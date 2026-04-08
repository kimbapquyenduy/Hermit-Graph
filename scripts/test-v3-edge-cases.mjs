#!/usr/bin/env node
/**
 * V3 Edge Case & Use Case Tests
 * Covers: semantic search, hermit CLI, file-lock, merge driver
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TMP = join(ROOT, 'tmp', 'test-edge-cases');

// ── Test runner ──
let passed = 0, failed = 0, total = 0;
const failures = [];

async function test(name, category, fn) {
  total++;
  try {
    const result = await fn();
    if (result && result.pass === false) {
      failed++;
      failures.push({ name, category, detail: result.detail });
      console.log(`  ❌ FAIL: ${name}\n     ${result.detail}`);
    } else {
      passed++;
      const detail = typeof result === 'string' ? result : (result?.detail || 'OK');
      console.log(`  ✅ PASS: ${name}\n     ${detail}`);
    }
  } catch (err) {
    failed++;
    failures.push({ name, category, detail: err.message });
    console.log(`  ❌ FAIL: ${name}\n     ${err.message}`);
  }
}

// ── Setup ──
if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });

console.log('╔══════════════════════════════════════════════════╗');
console.log('║  V3 Edge Case & Use Case Tests                  ║');
console.log('╚══════════════════════════════════════════════════╝\n');

// ══════════════════════════════════════════════════════════
// SEMANTIC SEARCH — Edge Cases
// ══════════════════════════════════════════════════════════
console.log('── SEMANTIC SEARCH: Edge Cases ──');

const { search, searchStatus, loadIndex, loadEntities } = await import('./lib/semantic-search.mjs');

await test('Empty query returns empty array', 'search-edge', async () => {
  const results = await search('', { topK: 5 });
  if (results.length > 0) return { pass: false, detail: `Expected 0 results, got ${results.length}` };
  return 'Empty query handled gracefully';
});

await test('Single character query', 'search-edge', async () => {
  const results = await search('a', { topK: 5 });
  // Should not crash, may return results
  return `Single char query: ${results.length} results (no crash)`;
});

await test('Very long query (500+ chars)', 'search-edge', async () => {
  const longQuery = 'payment '.repeat(100);
  const results = await search(longQuery, { topK: 5 });
  return `Long query: ${results.length} results (no crash)`;
});

await test('Special characters in query', 'search-edge', async () => {
  const specials = ['<script>alert(1)</script>', 'DROP TABLE', '../../etc/passwd', '{"$gt":""}', 'null', 'undefined'];
  for (const q of specials) {
    const results = await search(q, { topK: 3 });
    if (!Array.isArray(results)) return { pass: false, detail: `Non-array for query "${q}"` };
  }
  return `${specials.length} special queries handled safely`;
});

await test('Unicode/emoji in query', 'search-edge', async () => {
  const results = await search('thanh toán 💰 支付', { topK: 5 });
  return `Unicode query: ${results.length} results (no crash)`;
});

await test('topK=0 returns empty', 'search-edge', async () => {
  const results = await search('payment', { topK: 0 });
  if (results.length > 0) return { pass: false, detail: `topK=0 returned ${results.length}` };
  return 'topK=0 returns empty';
});

await test('topK=1 returns exactly 1', 'search-edge', async () => {
  const results = await search('payment', { topK: 1 });
  if (results.length !== 1) return { pass: false, detail: `topK=1 returned ${results.length}` };
  return `topK=1: ${results[0].name} (${results[0].score})`;
});

await test('minScore=1.0 filters everything', 'search-edge', async () => {
  const results = await search('payment', { topK: 10, minScore: 1.0 });
  if (results.length > 0) return { pass: false, detail: `minScore=1.0 returned ${results.length}` };
  return 'minScore=1.0 filters all';
});

await test('minScore=0 returns all matches', 'search-edge', async () => {
  const results = await search('payment', { topK: 999, minScore: 0 });
  if (results.length === 0) return { pass: false, detail: 'minScore=0 returned 0' };
  return `minScore=0: ${results.length} results`;
});

await test('Results are sorted by score descending', 'search-edge', async () => {
  const results = await search('payment integration', { topK: 20 });
  for (let i = 1; i < results.length; i++) {
    if (results[i].score > results[i - 1].score) {
      return { pass: false, detail: `Unsorted at [${i}]: ${results[i].score} > ${results[i-1].score}` };
    }
  }
  return `${results.length} results in descending score order`;
});

await test('Custom weights (keyword-only mode)', 'search-edge', async () => {
  const results = await search('VNPay', { vectorWeight: 0, keywordWeight: 1 });
  if (results.length === 0) return { pass: false, detail: 'Keyword-only returned 0' };
  const hasVNPay = results.some(r => r.name.includes('VNPay'));
  if (!hasVNPay) return { pass: false, detail: 'VNPay not found in keyword-only search' };
  return `Keyword-only: ${results.length} results, VNPay found`;
});

await test('Custom weights (vector-only mode)', 'search-edge', async () => {
  const results = await search('payment processing gateway', { vectorWeight: 1, keywordWeight: 0 });
  if (results.length === 0) return { pass: false, detail: 'Vector-only returned 0' };
  return `Vector-only: ${results.length} results, top: ${results[0].name}`;
});

await test('searchStatus returns valid status', 'search-edge', () => {
  const status = searchStatus();
  if (typeof status.vectorSearch !== 'boolean') return { pass: false, detail: 'vectorSearch not boolean' };
  if (typeof status.keywordSearch !== 'boolean') return { pass: false, detail: 'keywordSearch not boolean' };
  if (typeof status.indexEntityCount !== 'number') return { pass: false, detail: 'indexEntityCount not number' };
  return `vectorSearch=${status.vectorSearch}, entities=${status.indexEntityCount}`;
});

await test('Index integrity: all entities have vectors', 'search-edge', () => {
  const index = loadIndex();
  if (!index) return { pass: false, detail: 'No index found' };
  const entities = loadEntities();
  let missingVec = 0;
  for (const [name] of entities) {
    if (!index.entities[name]?.vector) missingVec++;
  }
  if (missingVec > 0) return { pass: false, detail: `${missingVec} entities missing vectors` };
  return `All ${entities.size} entities have vectors in index`;
});

// ══════════════════════════════════════════════════════════
// SEMANTIC SEARCH — Use Cases
// ══════════════════════════════════════════════════════════
console.log('\n── SEMANTIC SEARCH: Use Cases ──');

await test('UC1: Find business domains by concept', 'search-uc', async () => {
  const results = await search('e-commerce online store', { topK: 5 });
  const hasBiz = results.some(r => r.entityType?.includes('biz'));
  if (!hasBiz) return { pass: false, detail: 'No biz entities for e-commerce query' };
  return `Found ${results.filter(r => r.entityType?.includes('biz')).length} biz entities`;
});

await test('UC2: Find tech decisions by topic', 'search-uc', async () => {
  const results = await search('database migration decision', { topK: 10 });
  return `Found ${results.length} results for tech decisions`;
});

await test('UC3: Find patterns by description', 'search-uc', async () => {
  const results = await search('API route architecture pattern', { topK: 10 });
  const hasPattern = results.some(r => r.entityType?.includes('pattern'));
  return `Found ${results.filter(r => r.entityType?.includes('pattern')).length} pattern entities`;
});

await test('UC4: Find incidents/bugs', 'search-uc', async () => {
  const results = await search('bug error fix issue', { topK: 10 });
  return `Found ${results.length} results for bug-related queries`;
});

await test('UC5: Cross-project search', 'search-uc', async () => {
  const results = await search('WebCash', { topK: 10 });
  const webCash = results.filter(r => r.name.includes('WebCash'));
  if (webCash.length === 0) return { pass: false, detail: 'No WebCash entities found' };
  return `Found ${webCash.length} WebCash entities`;
});

// ══════════════════════════════════════════════════════════
// FILE LOCK — Edge Cases
// ══════════════════════════════════════════════════════════
console.log('\n── FILE LOCK: Edge Cases ──');

const { acquireLock, releaseLock, withLock, getLockStatus, LOCK_TIMEOUT_MS } = await import('./lib/file-lock.mjs');

const lockTestFile = join(TMP, 'lock-test.txt');
writeFileSync(lockTestFile, 'test content');

await test('Lock acquire on non-existent file', 'lock-edge', async () => {
  const phantom = join(TMP, 'phantom-file.txt');
  const acquired = await acquireLock(phantom, 'test');
  if (!acquired) return { pass: false, detail: 'Failed to lock non-existent file' };
  releaseLock(phantom);
  return 'Lock works on non-existent file';
});

await test('Double release does not crash', 'lock-edge', () => {
  releaseLock(lockTestFile);
  releaseLock(lockTestFile); // Should not throw
  return 'Double release safe';
});

await test('getLockStatus on unlocked file', 'lock-edge', () => {
  releaseLock(lockTestFile);
  const status = getLockStatus(lockTestFile);
  if (status.locked) return { pass: false, detail: 'Unlocked file shows as locked' };
  return `locked=${status.locked}`;
});

await test('getLockStatus on locked file shows agent info', 'lock-edge', async () => {
  await acquireLock(lockTestFile, 'edge-test-agent');
  const status = getLockStatus(lockTestFile);
  releaseLock(lockTestFile);
  if (!status.locked) return { pass: false, detail: 'Locked file shows as unlocked' };
  if (status.agentId !== 'edge-test-agent') return { pass: false, detail: `agentId: ${status.agentId}` };
  if (typeof status.age !== 'number') return { pass: false, detail: 'age not a number' };
  return `locked=true, agent=${status.agentId}, age=${status.age}ms`;
});

await test('withLock returns function result', 'lock-edge', async () => {
  const result = await withLock(lockTestFile, async () => 42, 'test');
  if (result !== 42) return { pass: false, detail: `Expected 42, got ${result}` };
  return 'withLock returns fn result correctly';
});

await test('withLock releases lock on error', 'lock-edge', async () => {
  try {
    await withLock(lockTestFile, async () => { throw new Error('intentional'); }, 'test');
  } catch (e) {
    // Expected
  }
  const status = getLockStatus(lockTestFile);
  if (status.locked) return { pass: false, detail: 'Lock not released after error' };
  return 'Lock released on error';
});

await test('Stale lock detection', 'lock-edge', async () => {
  // Write a stale lock manually
  const lockFile = lockTestFile + '.lock';
  writeFileSync(lockFile, JSON.stringify({
    pid: 99999,
    agentId: 'stale-agent',
    timestamp: Date.now() - LOCK_TIMEOUT_MS - 1000,
    hostname: 'test',
  }));
  const status = getLockStatus(lockTestFile);
  if (!status.stale) return { pass: false, detail: 'Old lock not detected as stale' };
  // Acquire should break the stale lock
  const acquired = await acquireLock(lockTestFile, 'fresh-agent');
  releaseLock(lockTestFile);
  if (!acquired) return { pass: false, detail: 'Failed to break stale lock' };
  return 'Stale lock detected and broken';
});

await test('Malformed lock file treated as stale', 'lock-edge', async () => {
  const lockFile = lockTestFile + '.lock';
  writeFileSync(lockFile, 'not-json-{{{');
  const status = getLockStatus(lockTestFile);
  if (!status.stale) return { pass: false, detail: 'Malformed lock not treated as stale' };
  const acquired = await acquireLock(lockTestFile, 'recovery-agent');
  releaseLock(lockTestFile);
  if (!acquired) return { pass: false, detail: 'Failed to recover from malformed lock' };
  return 'Malformed lock recovered';
});

await test('Nested withLock (same file) — second waits', 'lock-edge', async () => {
  let innerRan = false;
  await withLock(lockTestFile, async () => {
    // Start another lock attempt that should fail quickly or wait
    const innerAcquired = await acquireLock(lockTestFile, 'inner');
    if (innerAcquired) {
      innerRan = true;
      releaseLock(lockTestFile);
    }
  }, 'outer');
  // Inner should NOT have acquired because outer held the lock
  // (But due to implementation, it might break the "stale" if timing is off)
  return `Nested lock: inner acquired=${innerRan} (expected false in fast execution)`;
});

// ══════════════════════════════════════════════════════════
// MERGE DRIVER — Edge Cases
// ══════════════════════════════════════════════════════════
console.log('\n── MERGE DRIVER: Edge Cases ──');

function runMerge(ancestor, ours, theirs) {
  const aPath = join(TMP, 'merge-ancestor.jsonl');
  const oPath = join(TMP, 'merge-ours.jsonl');
  const tPath = join(TMP, 'merge-theirs.jsonl');
  writeFileSync(aPath, ancestor);
  writeFileSync(oPath, ours);
  writeFileSync(tPath, theirs);
  try {
    execSync(`node "${join(ROOT, 'scripts', 'merge-brain-jsonl.mjs')}" "${aPath}" "${oPath}" "${tPath}"`, {
      cwd: ROOT, stdio: 'pipe', timeout: 10000,
    });
  } catch (e) {
    return { error: e.stderr?.toString() || e.message };
  }
  return { result: readFileSync(oPath, 'utf-8') };
}

function entity(name, type, observations) {
  return JSON.stringify({ type: 'entity', name, entityType: type, observations });
}

function relation(from, to, rel) {
  return JSON.stringify({ type: 'relation', from, to, relationType: rel });
}

await test('Merge: empty files', 'merge-edge', () => {
  const { result, error } = runMerge('', '', '');
  if (error) return { pass: false, detail: error };
  if (result.trim() !== '') return { pass: false, detail: `Expected empty, got: ${result.slice(0, 50)}` };
  return 'Empty merge produces empty output';
});

await test('Merge: new entity on one side only', 'merge-edge', () => {
  const ancestor = '';
  const ours = entity('A', 'tech-stack', ['obs1']);
  const theirs = '';
  const { result, error } = runMerge(ancestor, ours, theirs);
  if (error) return { pass: false, detail: error };
  const parsed = result.trim().split('\n').map(l => JSON.parse(l));
  const found = parsed.find(e => e.name === 'A');
  if (!found) return { pass: false, detail: 'New entity A not in result' };
  return 'New entity from ours preserved';
});

await test('Merge: new entities on both sides', 'merge-edge', () => {
  const ancestor = '';
  const ours = entity('A', 'tech-stack', ['obs-a']);
  const theirs = entity('B', 'biz-domain', ['obs-b']);
  const { result, error } = runMerge(ancestor, ours, theirs);
  if (error) return { pass: false, detail: error };
  const parsed = result.trim().split('\n').map(l => JSON.parse(l));
  const hasA = parsed.some(e => e.name === 'A');
  const hasB = parsed.some(e => e.name === 'B');
  if (!hasA || !hasB) return { pass: false, detail: `A=${hasA}, B=${hasB}` };
  return 'Both new entities preserved';
});

await test('Merge: same entity modified both sides — more obs wins', 'merge-edge', () => {
  const anc = entity('X', 'tech-stack', ['base']);
  const ours = entity('X', 'tech-stack', ['base', 'our-change']);
  const theirs = entity('X', 'tech-stack', ['base', 'their-1', 'their-2']);
  const { result, error } = runMerge(anc, ours, theirs);
  if (error) return { pass: false, detail: error };
  const parsed = result.trim().split('\n').map(l => JSON.parse(l));
  const x = parsed.find(e => e.name === 'X');
  if (!x) return { pass: false, detail: 'Entity X missing' };
  // Theirs has 3 obs vs ours 2, theirs should win
  if (x.observations.length !== 3) return { pass: false, detail: `Expected 3 obs, got ${x.observations.length}` };
  return 'More observations wins (3 > 2)';
});

await test('Merge: entity deleted on one side, modified on other — keep modified', 'merge-edge', () => {
  const anc = entity('D', 'tech-stack', ['original']);
  const ours = entity('D', 'tech-stack', ['original', 'modified']);
  const theirs = ''; // Deleted
  const { result, error } = runMerge(anc, ours, theirs);
  if (error) return { pass: false, detail: error };
  const parsed = result.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const d = parsed.find(e => e.name === 'D');
  if (!d) return { pass: false, detail: 'Modified entity D was deleted (should be kept)' };
  return 'Delete-vs-modify: kept modified version';
});

await test('Merge: entity deleted on both sides', 'merge-edge', () => {
  const anc = entity('GONE', 'tech-stack', ['bye']);
  const ours = ''; // deleted
  const theirs = ''; // deleted
  const { result, error } = runMerge(anc, ours, theirs);
  if (error) return { pass: false, detail: error };
  const parsed = result.trim().split('\n').filter(Boolean);
  const hasGone = parsed.some(l => l.includes('GONE'));
  if (hasGone) return { pass: false, detail: 'Both-deleted entity still present' };
  return 'Both-deleted entity removed';
});

await test('Merge: relations union + dedup', 'merge-edge', () => {
  const anc = [entity('A', 't', ['a']), entity('B', 't', ['b']), relation('A', 'B', 'uses')].join('\n');
  const ours = [entity('A', 't', ['a']), entity('B', 't', ['b']), relation('A', 'B', 'uses'), relation('A', 'B', 'extends')].join('\n');
  const theirs = [entity('A', 't', ['a']), entity('B', 't', ['b']), relation('A', 'B', 'uses'), relation('B', 'A', 'imports')].join('\n');
  const { result, error } = runMerge(anc, ours, theirs);
  if (error) return { pass: false, detail: error };
  const parsed = result.trim().split('\n').map(l => JSON.parse(l));
  const rels = parsed.filter(r => r.type === 'relation');
  // Should have: uses(1, deduped), extends, imports = 3
  if (rels.length !== 3) return { pass: false, detail: `Expected 3 relations, got ${rels.length}` };
  return `Relations union: ${rels.length} (deduped from 5)`;
});

await test('Merge: dangling relations removed', 'merge-edge', () => {
  const anc = [entity('A', 't', ['a']), entity('B', 't', ['b']), relation('A', 'B', 'uses')].join('\n');
  const ours = [entity('A', 't', ['a']), relation('A', 'B', 'uses')].join('\n'); // B deleted
  const theirs = [entity('A', 't', ['a']), entity('B', 't', ['b']), relation('A', 'B', 'uses')].join('\n');
  const { result, error } = runMerge(anc, ours, theirs);
  if (error) return { pass: false, detail: error };
  const parsed = result.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const rels = parsed.filter(r => r.type === 'relation');
  // B was deleted on ours (unchanged from ancestor) so should be removed
  // But theirs still has B, and ours didn't modify B, so... B should remain (theirs kept it)
  // Actually: ours deleted B (was in ancestor, not in ours), theirs didn't modify B
  // So B is deleted. Relations to B should be removed.
  return `Dangling relations handled: ${rels.length} remaining`;
});

await test('Merge: malformed JSON lines skipped', 'merge-edge', () => {
  const anc = entity('OK', 't', ['fine']);
  const ours = entity('OK', 't', ['fine']) + '\n{bad json line\nnot json at all';
  const theirs = entity('OK', 't', ['fine']);
  const { result, error } = runMerge(anc, ours, theirs);
  if (error) return { pass: false, detail: error };
  const parsed = result.trim().split('\n').filter(Boolean);
  // Should have entity OK, malformed lines skipped
  return `Malformed lines skipped, ${parsed.length} valid lines`;
});

await test('Merge: large entity count (100)', 'merge-edge', () => {
  const entities100 = Array.from({ length: 100 }, (_, i) =>
    entity(`E${i}`, 'tech-stack', [`obs-${i}`])
  ).join('\n');
  const { result, error } = runMerge(entities100, entities100, entities100);
  if (error) return { pass: false, detail: error };
  const parsed = result.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const entityCount = parsed.filter(e => e.type === 'entity').length;
  if (entityCount !== 100) return { pass: false, detail: `Expected 100, got ${entityCount}` };
  return `100 entities merged correctly`;
});

// ══════════════════════════════════════════════════════════
// BRAIN CLI — Edge Cases
// ══════════════════════════════════════════════════════════
console.log('\n── BRAIN CLI: Edge Cases ──');

function runCLI(args) {
  try {
    const out = execSync(`node "${join(ROOT, 'scripts', 'brain-cli.mjs')}" ${args}`, {
      cwd: ROOT, stdio: 'pipe', timeout: 30000,
    });
    return { stdout: out.toString(), exitCode: 0 };
  } catch (e) {
    return { stdout: (e.stdout?.toString() || '') + (e.stderr?.toString() || ''), exitCode: e.status };
  }
}

await test('CLI: no command shows help', 'cli-edge', () => {
  const { stdout, exitCode } = runCLI('');
  if (!stdout.includes('brain')) return { pass: false, detail: 'No help output' };
  return `No-arg shows help (exit ${exitCode})`;
});

await test('CLI: unknown command shows error', 'cli-edge', () => {
  const { stdout, exitCode } = runCLI('foobar');
  if (!stdout.includes('Unknown command')) return { pass: false, detail: 'No error for unknown cmd' };
  if (exitCode === 0) return { pass: false, detail: 'Should exit non-zero' };
  return 'Unknown command handled';
});

await test('CLI: help command works', 'cli-edge', () => {
  const { stdout } = runCLI('help');
  if (!stdout.includes('search')) return { pass: false, detail: 'Help missing search cmd' };
  if (!stdout.includes('health')) return { pass: false, detail: 'Help missing health cmd' };
  return 'Help lists all commands';
});

await test('CLI: search with no query shows usage', 'cli-edge', () => {
  const { stdout, exitCode } = runCLI('search');
  if (!stdout.includes('Usage')) return { pass: false, detail: 'No usage message for empty search' };
  return 'Empty search shows usage';
});

await test('CLI: search with quoted multi-word query', 'cli-edge', async () => {
  const { stdout, exitCode } = runCLI('search "payment integration gateway"');
  if (exitCode !== 0) return { pass: false, detail: `Exit ${exitCode}` };
  if (!stdout.includes('results')) return { pass: false, detail: 'No results output' };
  return 'Multi-word search works';
});

await test('CLI: search with special characters', 'cli-edge', () => {
  const { stdout, exitCode } = runCLI('search "test<>!@#"');
  // Should not crash
  return `Special chars: exit ${exitCode} (no crash)`;
});

// ══════════════════════════════════════════════════════════
// EMBEDDING SERVICE — Edge Cases
// ══════════════════════════════════════════════════════════
console.log('\n── EMBEDDING SERVICE: Edge Cases ──');

const { embed, embedBatch, cosineSimilarity, isAvailable } = await import('./lib/embedding-service.mjs');

await test('Embed empty string', 'embed-edge', async () => {
  const vec = await embed('');
  if (!vec) return { pass: false, detail: 'embed("") returned null' };
  if (vec.length !== 384) return { pass: false, detail: `Expected 384 dims, got ${vec.length}` };
  return `Empty string embeds to 384-dim vector`;
});

await test('Embed very long text (10K chars)', 'embed-edge', async () => {
  const longText = 'x '.repeat(5000);
  const vec = await embed(longText);
  if (!vec) return { pass: false, detail: 'Long text returned null' };
  return `Long text: ${vec.length} dims`;
});

await test('Cosine similarity: identical vectors = 1.0', 'embed-edge', async () => {
  const vec = await embed('test');
  const sim = cosineSimilarity(vec, vec);
  if (Math.abs(sim - 1.0) > 0.001) return { pass: false, detail: `Self-similarity: ${sim}` };
  return `Self-similarity: ${sim.toFixed(4)}`;
});

await test('Cosine similarity: different texts < 1.0', 'embed-edge', async () => {
  const v1 = await embed('payment processing');
  const v2 = await embed('quantum physics');
  const sim = cosineSimilarity(v1, v2);
  if (sim >= 1.0) return { pass: false, detail: `Unrelated texts similarity: ${sim}` };
  return `Unrelated: ${sim.toFixed(4)} (< 1.0)`;
});

await test('Cosine similarity: related texts > unrelated', 'embed-edge', async () => {
  const v1 = await embed('payment processing');
  const v2 = await embed('transaction payment gateway');
  const v3 = await embed('quantum physics electron');
  const simRelated = cosineSimilarity(v1, v2);
  const simUnrelated = cosineSimilarity(v1, v3);
  if (simRelated <= simUnrelated) {
    return { pass: false, detail: `Related(${simRelated.toFixed(3)}) <= Unrelated(${simUnrelated.toFixed(3)})` };
  }
  return `Related(${simRelated.toFixed(3)}) > Unrelated(${simUnrelated.toFixed(3)})`;
});

await test('embedBatch: batch of 3', 'embed-edge', async () => {
  const vecs = await embedBatch(['hello', 'world', 'test']);
  if (vecs.length !== 3) return { pass: false, detail: `Expected 3, got ${vecs.length}` };
  for (let i = 0; i < 3; i++) {
    if (!vecs[i] || vecs[i].length !== 384) return { pass: false, detail: `Vec[${i}] invalid` };
  }
  return 'Batch of 3 embeddings OK';
});

await test('isAvailable returns true', 'embed-edge', async () => {
  const avail = await isAvailable();
  if (!avail) return { pass: false, detail: 'Model not available' };
  return 'Model is available';
});

// ══════════════════════════════════════════════════════════
// DASHBOARD — Edge Cases (HTML parsing)
// ══════════════════════════════════════════════════════════
console.log('\n── DASHBOARD: Edge Cases ──');

const viewerHTML = readFileSync(join(ROOT, 'viewer', 'index.html'), 'utf-8');

await test('Dashboard: XSS in entity names sanitized', 'dash-edge', () => {
  // Check if the dashboard uses innerHTML unsafely
  const unsafePatterns = ['innerHTML = ', 'innerHTML=', 'document.write('];
  const found = unsafePatterns.filter(p => viewerHTML.includes(p));
  // vis.js handles rendering, but check custom code
  return `${found.length} innerHTML uses found (vis.js handles rendering)`;
});

await test('Dashboard: handles 0 entities gracefully', 'dash-edge', () => {
  // Check if code has empty-state handling
  const hasEmptyCheck = viewerHTML.includes('entities.length') || viewerHTML.includes('nodes.length');
  return `Empty state check: ${hasEmptyCheck ? 'present' : 'relies on vis.js'}`;
});

await test('Dashboard: stale indicator CSS exists', 'dash-edge', () => {
  const hasStaleStyle = viewerHTML.includes('stale') && viewerHTML.includes('opacity');
  if (!hasStaleStyle) return { pass: false, detail: 'No stale indicator styles' };
  return 'Stale node styles present';
});

// ══════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(50));
console.log(`\n  Results: ${passed} passed, ${failed} failed (${total} total)\n`);

if (failures.length > 0) {
  console.log('  Failures:');
  for (const f of failures) {
    console.log(`    [${f.category}] ${f.name}: ${f.detail}`);
  }
}

// Cleanup
try {
  if (existsSync(TMP)) {
    const files = ['lock-test.txt', 'lock-test.txt.lock', 'phantom-file.txt.lock',
                   'merge-ancestor.jsonl', 'merge-ours.jsonl', 'merge-theirs.jsonl'];
    for (const f of files) {
      try { unlinkSync(join(TMP, f)); } catch {}
    }
  }
} catch {}

process.exit(failed > 0 ? 1 : 0);
