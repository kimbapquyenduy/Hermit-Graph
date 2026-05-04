#!/usr/bin/env node
/**
 * MemoryProvider contract conformance suite.
 * Exercises every method in the interface against JsonlProvider.
 * Any future provider can be tested by swapping the import.
 *
 * Run: node test/memory-provider-contract.test.mjs
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JsonlProvider } from '../scripts/lib/memory/jsonl-provider.mjs';
import { MemoryProvider } from '../scripts/lib/memory/provider-interface.mjs';
import { generateSampleVault } from '../scripts/lib/memory/test-fixtures.mjs';
import { writeBrain } from '../scripts/lib/brain-io.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TMP = join(ROOT, 'tmp', 'contract-test');

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
}

/** Build a fresh provider backed by a temp brain file. */
function makeProvider(filename = 'brain.jsonl') {
  const brainPath = join(TMP, filename);
  return new JsonlProvider({ brainPath });
}

/** Seed a provider's brain file with fixture data. */
function seedProvider(provider, vault) {
  writeBrain(provider._brainPath, vault.entities, vault.relations);
}

// ── Setup / Teardown ──

function setup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP, { recursive: true });
}

function cleanup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
}

// ══════════════════════════════════════════════════════════════════
// CONTRACT: capabilities()
// ══════════════════════════════════════════════════════════════════

async function testCapabilities() {
  console.log('\ncapabilities()');
  await test('returns object with keyword, vector, fts5 keys', () => {
    const p = makeProvider();
    const caps = p.capabilities();
    assert(typeof caps === 'object', 'capabilities must return object');
    assert('keyword' in caps, 'missing keyword flag');
    assert('vector' in caps, 'missing vector flag');
    assert('fts5' in caps, 'missing fts5 flag');
  });

  await test('JsonlProvider: keyword=true, fts5=false', () => {
    const p = makeProvider();
    const caps = p.capabilities();
    assert(caps.keyword === true, 'keyword should be true');
    assert(caps.fts5 === false, 'fts5 should be false');
  });
}

// ══════════════════════════════════════════════════════════════════
// CONTRACT: readAll()
// ══════════════════════════════════════════════════════════════════

async function testReadAll() {
  console.log('\nreadAll()');

  await test('returns { entities: Map, relations: [] } on empty brain', async () => {
    const p = makeProvider('empty.jsonl');
    const result = await p.readAll();
    assert(result.entities instanceof Map, 'entities must be a Map');
    assert(Array.isArray(result.relations), 'relations must be an array');
    assert(result.entities.size === 0, 'empty brain has no entities');
    assert(result.relations.length === 0, 'empty brain has no relations');
  });

  await test('returns correct entity + relation counts from fixture', async () => {
    const p = makeProvider('fixture-read.jsonl');
    const vault = generateSampleVault({ size: 20, seed: 1 });
    seedProvider(p, vault);
    const { entities, relations } = await p.readAll();
    assert(entities.size === 20, `expected 20 entities, got ${entities.size}`);
    assert(relations.length > 0, 'should have relations');
  });

  await test('entities values have required fields', async () => {
    const p = makeProvider('fixture-fields.jsonl');
    const vault = generateSampleVault({ size: 5, seed: 2 });
    seedProvider(p, vault);
    const { entities } = await p.readAll();
    for (const [, e] of entities) {
      assert(e.type === 'entity', `entity.type must be 'entity'`);
      assert(typeof e.name === 'string', 'entity.name must be string');
      assert(typeof e.entityType === 'string', 'entity.entityType must be string');
      assert(Array.isArray(e.observations), 'entity.observations must be array');
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// CONTRACT: getEntity()
// ══════════════════════════════════════════════════════════════════

async function testGetEntity() {
  console.log('\ngetEntity()');

  await test('returns entity for exact name', async () => {
    const p = makeProvider('get-exact.jsonl');
    const vault = generateSampleVault({ size: 10, seed: 3 });
    seedProvider(p, vault);
    const firstName = [...vault.entities.keys()][0];
    const e = await p.getEntity(firstName);
    assert(e !== null, 'should find entity by exact name');
    assert(e.name === firstName, 'returned entity has correct name');
  });

  await test('case-insensitive lookup', async () => {
    const p = makeProvider('get-case.jsonl');
    seedProvider(p, { entities: new Map([
      ['TECH:Auth:Token0', { type: 'entity', name: 'TECH:Auth:Token0', entityType: 'tech-stack', observations: [] }],
    ]), relations: [] });
    const e = await p.getEntity('tech:auth:token0');
    assert(e !== null, 'case-insensitive lookup must find entity');
    assert(e.name === 'TECH:Auth:Token0', 'returns canonical-case name');
  });

  await test('returns null for missing entity', async () => {
    const p = makeProvider('get-missing.jsonl');
    const result = await p.getEntity('NONEXISTENT:Entity:X');
    assert(result === null, 'missing entity must return null');
  });
}

// ══════════════════════════════════════════════════════════════════
// CONTRACT: writeEntity() + deleteEntity()
// ══════════════════════════════════════════════════════════════════

async function testWriteDelete() {
  console.log('\nwriteEntity() + deleteEntity()');

  await test('writeEntity: persists new entity (inside withLock)', async () => {
    const p = makeProvider('write-new.jsonl');
    const entity = {
      type: 'entity', name: 'TECH:Test:NewEntity0',
      entityType: 'tech-stack',
      observations: ['[0.8|2026-01-01] NOTE: test entity'],
    };
    await p.withLock(() => p.writeEntity(entity));
    const back = await p.getEntity('TECH:Test:NewEntity0');
    assert(back !== null, 'written entity must be readable back');
    assert(back.name === 'TECH:Test:NewEntity0', 'name must match');
  });

  await test('writeEntity: upserts (replaces) existing entity', async () => {
    const p = makeProvider('write-upsert.jsonl');
    const base = { type: 'entity', name: 'TECH:Test:Upsert0', entityType: 'tech-stack', observations: [] };
    await p.withLock(() => p.writeEntity(base));
    const updated = { ...base, observations: ['[0.9|2026-01-01] RULE: updated'] };
    await p.withLock(() => p.writeEntity(updated));
    const back = await p.getEntity('TECH:Test:Upsert0');
    assert(back.observations.length === 1, 'upsert must overwrite, not append');
    assert(back.observations[0].includes('updated'), 'should have updated observation');
  });

  await test('deleteEntity: removes existing entity, returns true', async () => {
    const p = makeProvider('delete-existing.jsonl');
    const entity = { type: 'entity', name: 'TECH:Test:Delete0', entityType: 'tech-stack', observations: [] };
    await p.withLock(() => p.writeEntity(entity));
    const deleted = await p.withLock(() => p.deleteEntity('TECH:Test:Delete0'));
    assert(deleted === true, 'deleteEntity must return true for existing entity');
    const back = await p.getEntity('TECH:Test:Delete0');
    assert(back === null, 'deleted entity must not be readable');
  });

  await test('deleteEntity: returns false for non-existent entity', async () => {
    const p = makeProvider('delete-missing.jsonl');
    const deleted = await p.withLock(() => p.deleteEntity('TECH:Ghost:Entity999'));
    assert(deleted === false, 'deleteEntity must return false when not found');
  });
}

// ══════════════════════════════════════════════════════════════════
// CONTRACT: writeRelation()
// ══════════════════════════════════════════════════════════════════

async function testWriteRelation() {
  console.log('\nwriteRelation()');

  await test('persists new relation', async () => {
    const p = makeProvider('write-rel.jsonl');
    const rel = { type: 'relation', from: 'A', to: 'B', relationType: 'uses' };
    await p.withLock(() => p.writeRelation(rel));
    const { relations } = await p.readAll();
    assert(relations.length === 1, `expected 1 relation, got ${relations.length}`);
    assert(relations[0].from === 'A' && relations[0].to === 'B', 'relation fields must match');
  });

  await test('skips duplicate relations', async () => {
    const p = makeProvider('write-rel-dup.jsonl');
    const rel = { from: 'X', to: 'Y', relationType: 'depends_on' };
    await p.withLock(() => p.writeRelation(rel));
    await p.withLock(() => p.writeRelation(rel));
    const { relations } = await p.readAll();
    assert(relations.length === 1, 'duplicate relation must not be written twice');
  });
}

// ══════════════════════════════════════════════════════════════════
// CONTRACT: searchKeyword()
// ══════════════════════════════════════════════════════════════════

async function testSearchKeyword() {
  console.log('\nsearchKeyword()');

  await test('returns results ranked by score descending', async () => {
    const p = makeProvider('search-kw.jsonl');
    const vault = generateSampleVault({ size: 50, seed: 7 });
    seedProvider(p, vault);
    const results = await p.searchKeyword('Auth', { topK: 10 });
    assert(Array.isArray(results), 'results must be array');
    for (let i = 1; i < results.length; i++) {
      assert(results[i - 1].score >= results[i].score, 'results must be sorted descending');
    }
  });

  await test('each result has name, entityType, score', async () => {
    const p = makeProvider('search-kw-fields.jsonl');
    const vault = generateSampleVault({ size: 20, seed: 8 });
    seedProvider(p, vault);
    const results = await p.searchKeyword('pattern', { topK: 5 });
    for (const r of results) {
      assert(typeof r.name === 'string', 'result.name must be string');
      assert(typeof r.entityType === 'string', 'result.entityType must be string');
      assert(typeof r.score === 'number', 'result.score must be number');
      assert(r.score >= 0 && r.score <= 1, `score out of range: ${r.score}`);
    }
  });

  await test('empty query returns empty array', async () => {
    const p = makeProvider('search-kw-empty.jsonl');
    const results = await p.searchKeyword('', {});
    assert(Array.isArray(results) && results.length === 0, 'empty query must return []');
  });

  await test('respects topK option', async () => {
    const p = makeProvider('search-kw-topk.jsonl');
    const vault = generateSampleVault({ size: 100, seed: 9 });
    seedProvider(p, vault);
    const results = await p.searchKeyword('tech', { topK: 3 });
    assert(results.length <= 3, `topK=3 must return at most 3 results, got ${results.length}`);
  });
}

// ══════════════════════════════════════════════════════════════════
// CONTRACT: withLock()
// ══════════════════════════════════════════════════════════════════

async function testWithLock() {
  console.log('\nwithLock()');

  await test('resolves with fn return value', async () => {
    const p = makeProvider('lock-return.jsonl');
    const val = await p.withLock(() => 42);
    assert(val === 42, 'withLock must return fn result');
  });

  await test('serializes concurrent writes (no data loss)', async () => {
    const p = makeProvider('lock-concurrent.jsonl');
    // Seed empty file so brain-io does not fail on first read
    seedProvider(p, { entities: new Map(), relations: [] });
    const writes = Array.from({ length: 10 }, (_, i) => (
      p.withLock(() => p.writeEntity({
        type: 'entity', name: `TECH:Lock:Entity${i}`,
        entityType: 'tech-stack', observations: [],
      }))
    ));
    await Promise.all(writes);
    const { entities } = await p.readAll();
    // Filter out only entities written in this test (name prefix TECH:Lock:)
    const lockEntities = [...entities.values()].filter(e => e.name.startsWith('TECH:Lock:'));
    assert(lockEntities.length === 10, `expected 10 concurrent entities, got ${lockEntities.length}`);
  });
}

// ══════════════════════════════════════════════════════════════════
// CONTRACT: interface base throws
// ══════════════════════════════════════════════════════════════════

async function testBaseThrows() {
  console.log('\nMemoryProvider base class throws');

  const base = new MemoryProvider();
  const methods = ['readAll', 'writeEntity', 'writeRelation', 'deleteEntity', 'getEntity', 'searchKeyword', 'searchVector', 'withLock'];

  for (const method of methods) {
    await test(`base.${method}() throws 'not implemented'`, async () => {
      try {
        await base[method]();
        throw new Error('should have thrown');
      } catch (e) {
        assert(e.message === 'not implemented', `expected 'not implemented', got '${e.message}'`);
      }
    });
  }

  await test('base.capabilities() throws not implemented', () => {
    try {
      base.capabilities();
      throw new Error('should have thrown');
    } catch (e) {
      assert(e.message === 'not implemented', `got: ${e.message}`);
    }
  });
}

// ── Main ──

setup();
try {
  await testCapabilities();
  await testReadAll();
  await testGetEntity();
  await testWriteDelete();
  await testWriteRelation();
  await testSearchKeyword();
  await testWithLock();
  await testBaseThrows();
} finally {
  cleanup();
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
