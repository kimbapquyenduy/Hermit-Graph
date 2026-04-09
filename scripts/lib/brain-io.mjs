/**
 * Brain JSONL I/O — read/write entities and relations with file-lock.
 * Source of truth: data/brain.jsonl (one JSON object per line).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { dirname } from 'path';
import { withLock } from './file-lock.mjs';

// ── Mtime-based read cache (Phase 3a) ──
let _cachedBrain = null;
let _cachedMtimeMs = null;
let _cachedPath = null;

/**
 * Read brain.jsonl into entities Map + relations array.
 * Lock-free — safe for concurrent reads. Mtime-cached for repeated reads.
 * @param {string} brainPath
 * @returns {{ entities: Map<string, object>, relations: object[] }}
 */
export function readBrain(brainPath) {
  if (!existsSync(brainPath)) return { entities: new Map(), relations: [] };

  const mtime = statSync(brainPath).mtimeMs;
  if (_cachedBrain && _cachedPath === brainPath && _cachedMtimeMs === mtime) {
    return _cachedBrain;
  }

  const lines = readFileSync(brainPath, 'utf-8').split('\n').filter(Boolean);
  const entities = new Map();
  const relations = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'entity') entities.set(obj.name, obj);
      else if (obj.type === 'relation') relations.push(obj);
    } catch { /* skip malformed lines */ }
  }

  const result = { entities, relations };
  _cachedBrain = result;
  _cachedMtimeMs = mtime;
  _cachedPath = brainPath;
  return result;
}

/**
 * Write full brain state to JSONL (entities first, then relations).
 * MUST be called inside withBrainLock.
 * @param {string} brainPath
 * @param {Map<string, object>|Iterable} entities
 * @param {object[]} relations
 */
export function writeBrain(brainPath, entities, relations) {
  const dir = dirname(brainPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const values = entities instanceof Map ? entities.values() : entities;
  const lines = [];
  for (const entity of values) lines.push(JSON.stringify(entity));
  for (const rel of relations) lines.push(JSON.stringify(rel));
  writeFileSync(brainPath, lines.join('\n') + (lines.length ? '\n' : ''));
  // Invalidate read cache after write
  _cachedBrain = null;
  _cachedMtimeMs = null;
}

/**
 * Execute fn while holding exclusive write lock on brain.jsonl.
 * @param {string} brainPath
 * @param {Function} fn - async function to execute
 * @returns {Promise<*>}
 */
export async function withBrainLock(brainPath, fn) {
  return withLock(brainPath, fn, 'hermit-mcp');
}
