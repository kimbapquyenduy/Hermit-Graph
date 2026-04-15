/**
 * Code-symbols.jsonl I/O — mtime-cached reads, atomic writes with file-lock.
 * Follows brain-io.mjs patterns: readFileSync, tmp+rename, cache invalidation.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { withLock } from '../file-lock.mjs';
import { CodeGraph } from './graph.mjs';

const FILENAME = 'code-symbols.jsonl';

// ── Mtime-based read cache ──

let _cached = null;
let _cachedMtime = null;
let _cachedPath = null;

/**
 * Resolve path to code-symbols.jsonl within a data directory.
 * @param {string} dataDir — typically 'data/' or project .hermit/
 * @returns {string} absolute path
 */
export function codeGraphPath(dataDir) {
  return resolve(join(dataDir, FILENAME));
}

/**
 * Read code-symbols.jsonl into a CodeGraph instance.
 * Mtime-cached — returns same instance if file unchanged.
 * @param {string} dataDir
 * @returns {CodeGraph}
 */
export function readCodeGraph(dataDir) {
  const p = codeGraphPath(dataDir);
  if (!existsSync(p)) return new CodeGraph();

  const mtime = statSync(p).mtimeMs;
  if (_cached && _cachedPath === p && _cachedMtime === mtime) return _cached;

  const lines = readFileSync(p, 'utf-8').split('\n').filter(Boolean);
  const symbols = [];
  const relations = [];
  let meta = null;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj._type === 'symbol') symbols.push(obj);
      else if (obj._type === 'relation') relations.push(obj);
      else if (obj._type === 'meta') meta = obj;
    } catch { /* skip malformed lines */ }
  }

  const graph = CodeGraph.fromEntries(symbols, relations, meta);
  _cached = graph;
  _cachedMtime = mtime;
  _cachedPath = p;
  return graph;
}

/**
 * Write full CodeGraph to code-symbols.jsonl atomically.
 * Uses file-lock to prevent concurrent write corruption.
 * @param {string} dataDir
 * @param {CodeGraph} codeGraph
 */
export async function writeCodeGraph(dataDir, codeGraph) {
  const p = codeGraphPath(dataDir);
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  await withLock(p, () => {
    const { meta, symbols, relations } = codeGraph.toEntries();
    const lines = [
      JSON.stringify({ _v: 1, _type: 'meta', ...meta }),
      ...symbols.map(s => JSON.stringify(s)),
      ...relations.map(r => JSON.stringify(r)),
    ];
    const tmp = p + '.tmp';
    writeFileSync(tmp, lines.join('\n') + '\n');
    renameSync(tmp, p);
    // Invalidate cache so next read picks up fresh data
    _cached = null;
    _cachedMtime = null;
  }, 'code-intel');
}

/**
 * Delete code-symbols.jsonl (for full reindex).
 * @param {string} dataDir
 */
export function clearCodeGraph(dataDir) {
  const p = codeGraphPath(dataDir);
  try { unlinkSync(p); } catch { /* already gone */ }
  _cached = null;
  _cachedMtime = null;
}
