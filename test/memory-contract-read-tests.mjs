/**
 * MemoryProvider contract — read-side tests.
 * Covers: capabilities(), readAll(), getEntity(), base-class throws.
 */

import { MemoryProvider } from '../scripts/lib/memory/provider-interface.mjs';
import { generateSampleVault } from '../scripts/lib/memory/test-fixtures.mjs';
import { test, assert, makeProvider, seedProvider } from './memory-contract-helpers.mjs';

export async function runReadTests() {
  // ── capabilities() ──
  console.log('\ncapabilities()');

  await test('returns object with keyword, vector, fts5 keys', () => {
    const p = makeProvider('caps.jsonl');
    const caps = p.capabilities();
    assert(typeof caps === 'object', 'capabilities must return object');
    assert('keyword' in caps, 'missing keyword flag');
    assert('vector' in caps, 'missing vector flag');
    assert('fts5' in caps, 'missing fts5 flag');
  });

  await test('JsonlProvider: keyword=true, fts5=false', () => {
    const p = makeProvider('caps2.jsonl');
    const caps = p.capabilities();
    assert(caps.keyword === true, 'keyword should be true');
    assert(caps.fts5 === false, 'fts5 should be false');
  });

  // ── readAll() ──
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

  // ── getEntity() ──
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
    seedProvider(p, {
      entities: new Map([
        ['TECH:Auth:Token0', { type: 'entity', name: 'TECH:Auth:Token0', entityType: 'tech-stack', observations: [] }],
      ]),
      relations: [],
    });
    const e = await p.getEntity('tech:auth:token0');
    assert(e !== null, 'case-insensitive lookup must find entity');
    assert(e.name === 'TECH:Auth:Token0', 'returns canonical-case name');
  });

  await test('returns null for missing entity', async () => {
    const p = makeProvider('get-missing.jsonl');
    const result = await p.getEntity('NONEXISTENT:Entity:X');
    assert(result === null, 'missing entity must return null');
  });

  // ── MemoryProvider base throws ──
  console.log('\nMemoryProvider base class throws');

  const base = new MemoryProvider();
  const methods = [
    'readAll', 'writeEntity', 'writeRelation', 'deleteEntity',
    'getEntity', 'searchKeyword', 'searchVector', 'withLock',
  ];

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
