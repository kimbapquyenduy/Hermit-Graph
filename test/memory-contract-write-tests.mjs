/**
 * MemoryProvider contract — write-side tests.
 * Covers: writeEntity(), deleteEntity(), writeRelation(), searchKeyword(), withLock().
 */

import { generateSampleVault } from '../scripts/lib/memory/test-fixtures.mjs';
import { test, assert, makeProvider, seedProvider } from './memory-contract-helpers.mjs';

export async function runWriteTests() {
  // ── writeEntity() + deleteEntity() ──
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

  // ── writeRelation() ──
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

  // ── searchKeyword() ──
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

  // ── withLock() ──
  console.log('\nwithLock()');

  await test('resolves with fn return value', async () => {
    const p = makeProvider('lock-return.jsonl');
    const val = await p.withLock(() => 42);
    assert(val === 42, 'withLock must return fn result');
  });

  await test('serializes concurrent writes (no data loss)', async () => {
    const p = makeProvider('lock-concurrent.jsonl');
    seedProvider(p, { entities: new Map(), relations: [] });
    const writes = Array.from({ length: 10 }, (_, i) => (
      p.withLock(() => p.writeEntity({
        type: 'entity', name: `TECH:Lock:Entity${i}`,
        entityType: 'tech-stack', observations: [],
      }))
    ));
    await Promise.all(writes);
    const { entities } = await p.readAll();
    const lockEntities = [...entities.values()].filter(e => e.name.startsWith('TECH:Lock:'));
    assert(lockEntities.length === 10, `expected 10 concurrent entities, got ${lockEntities.length}`);
  });
}
