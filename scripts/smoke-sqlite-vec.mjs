/**
 * smoke-sqlite-vec.mjs
 *
 * Standalone smoke test: verifies sqlite-vec loads cleanly inside better-sqlite3.
 * Creates a vec0 virtual table, inserts 3 seed-deterministic 384-dim vectors,
 * runs a kNN cosine-distance query, and asserts results are sane.
 *
 * Usage:  node scripts/smoke-sqlite-vec.mjs
 *         npm run smoke:vec
 *
 * Exit 0 = success. Exit 1 = failure (descriptive error printed to stderr).
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const DIMS = 384;

/**
 * Mulberry32 — deterministic 32-bit pseudo-random number generator.
 * @param {number} seed
 * @returns {() => number} next() → float in [0, 1)
 */
function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s |= 0;
    s = s + 0x6d2b79f5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a seed-deterministic 384-dim Float32Array.
 * @param {number} seed
 * @returns {Float32Array}
 */
function makeVector(seed) {
  const rng = mulberry32(seed);
  return Float32Array.from({ length: DIMS }, () => rng() * 2 - 1);
}

/**
 * Serialises Float32Array to the BLOB format sqlite-vec expects
 * (raw little-endian IEEE 754 bytes — same as the underlying buffer).
 * @param {Float32Array} v
 * @returns {Buffer}
 */
function vecToBlob(v) {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

async function main() {
  // ── 1. Open in-memory database ──────────────────────────────────────────────
  const db = new Database(':memory:');

  // ── 2. Load sqlite-vec extension ────────────────────────────────────────────
  // sqlite-vec ships a pre-built platform binary (win32 → vec0.dll).
  // loadExtension() is available on better-sqlite3 ≥9 without extra flags.
  // On win32/x64 the binary lives in node_modules/sqlite-vec-windows-x64/vec0.dll
  sqliteVec.load(db);

  // ── 3. Verify version ───────────────────────────────────────────────────────
  const { version } = db.prepare('SELECT vec_version() AS version').get();

  // ── 4. Create vec0 virtual table ────────────────────────────────────────────
  db.exec(`CREATE VIRTUAL TABLE t USING vec0(
    name TEXT PRIMARY KEY,
    e    FLOAT[${DIMS}]
  )`);

  // ── 5. Insert 3 seed-deterministic vectors ──────────────────────────────────
  const insert = db.prepare('INSERT INTO t(name, e) VALUES (?, ?)');
  const seeds = [42, 137, 999];
  const names = ['alpha', 'beta', 'gamma'];
  const vectors = seeds.map(makeVector);
  for (let i = 0; i < names.length; i++) {
    insert.run(names[i], vecToBlob(vectors[i]));
  }

  // ── 6. kNN query — find 2 nearest to a fresh query vector ───────────────────
  const query = makeVector(7);
  const rows = db
    .prepare(
      `SELECT name, vec_distance_cosine(e, ?) AS d
       FROM t
       ORDER BY d
       LIMIT 2`
    )
    .all(vecToBlob(query));

  // ── 7. Assertions ────────────────────────────────────────────────────────────
  if (rows.length !== 2) {
    throw new Error(`Expected 2 rows from kNN query, got ${rows.length}`);
  }
  for (const row of rows) {
    if (row.d < 0 || row.d > 2) {
      throw new Error(
        `Cosine distance out of range [0,2]: name=${row.name} d=${row.d}`
      );
    }
  }
  if (rows[0].d > rows[1].d) {
    throw new Error(
      `Results not ascending: d[0]=${rows[0].d} d[1]=${rows[1].d}`
    );
  }

  db.close();

  // ── 8. Success ───────────────────────────────────────────────────────────────
  console.log(
    `✓ sqlite-vec ${version} loaded on ${process.platform}/${process.arch}`
  );
  console.log(
    `  kNN results: ${rows.map(r => `${r.name}(d=${r.d.toFixed(4)})`).join(', ')}`
  );
}

main().catch(err => {
  console.error('✗ sqlite-vec smoke FAILED:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
