#!/usr/bin/env node
/** Regression: vector storage must use stable entity IDs, not display names. */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import * as sqliteVec from 'sqlite-vec';
import { SqliteVecBackend } from '../scripts/lib/memory/sqlite-vec-adapter.mjs';
import { BruteForceVectorBackend } from '../scripts/lib/memory/brute-force-vector-fallback.mjs';
import { entityId } from '../scripts/lib/memory/entity-identity.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const tempParent = join(process.cwd(), 'tmp');
mkdirSync(tempParent, { recursive: true });
const root = mkdtempSync(join(tempParent, 'hermit-vector-id-'));
const dim = 384;
const vector = (seed) => Float32Array.from({ length: dim }, (_, i) => (i === seed ? 1 : 0));

try {
  const db = Database(join(root, 'brain.db'));
  sqliteVec.load(db);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
  const backend = new SqliteVecBackend({ db });
  const alpha = { id: 'project-alpha/entity-1', projectId: 'alpha', name: 'TECH:Shared' };
  const beta = { id: 'project-beta/entity-1', projectId: 'beta', name: 'TECH:Shared' };

  assert.notEqual(entityId(alpha), entityId(beta));
  await backend.upsert(entityId(alpha), vector(0));
  await backend.upsert(entityId(beta), vector(1));
  assert.equal(await backend.count(), 2, 'same display name must not overwrite another project vector');

  const stored = db.prepare('SELECT name FROM vec_entities ORDER BY name').all().map(row => row.name);
  assert.deepEqual(stored, [alpha.id, beta.id]);
  const nearest = await backend.search(vector(1), 2);
  assert.equal(nearest[0].id, beta.id, 'search must return stable vector ID');
  db.close();

  const fallback = new BruteForceVectorBackend();
  await fallback.upsert(entityId(alpha), vector(0));
  await fallback.upsert(entityId(beta), vector(1));
  assert.equal(await fallback.count(), 2);
  assert.deepEqual((await fallback.search(vector(1), 2)).map(row => row.id), [beta.id, alpha.id]);
  console.log('ok vector identity collision regression');
} finally {
  rmSync(root, { recursive: true, force: true });
}
