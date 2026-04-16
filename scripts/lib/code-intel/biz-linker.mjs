/**
 * Biz-Linker — bridges CodeGraph blast radius with KG business rules.
 * Deterministic file-path join: matches affected files against RULE/FLOW
 * entities' FILES: observations. No LLM needed.
 */

import { readBrain } from '../brain-io.mjs';
import { parseObservation, obsText } from '../parse-observation.mjs';
import { resolve, relative } from 'path';
import { statSync, existsSync } from 'fs';

// ── Mtime-based index cache ──
let _indexCache = null;
let _indexMtimeMs = null;
let _indexPath = null;

/**
 * Normalize a file path for cross-platform comparison.
 * Strips line numbers, converts backslashes, removes leading ./ or project root.
 * @param {string} rawPath
 * @returns {string}
 */
export function normalizeFilePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  let p = rawPath.trim();
  p = p.replace(/:\d+(-\d+)?$/, '');  // strip :lineNum or :start-end
  p = p.replace(/\\/g, '/');           // backslash → forward slash
  p = p.replace(/^\.\//, '');          // strip leading ./
  return p.toLowerCase();              // case-insensitive (Windows)
}

/**
 * Parse a FILES: observation into normalized file paths.
 * Handles: FILES: path1, path2  |  FILE: path1  |  FILES: path1 path2
 * @param {string} text — observation text (after confidence prefix)
 * @returns {string[]}
 */
export function parseFilesObservation(text) {
  const match = text.match(/^FILES?:\s*(.+)/i);
  if (!match) return [];
  return match[1]
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(normalizeFilePath);
}

/**
 * Build a file→rule index from brain.jsonl.
 * Mtime-cached to avoid re-scanning on repeated calls.
 * @param {string} brainPath
 * @returns {Map<string, Array<{name: string, entityType: string, observation: string, confidence: number}>>}
 */
export function buildFileRuleIndex(brainPath) {
  const normalizedPath = resolve(brainPath);
  if (!existsSync(normalizedPath)) return new Map();

  const mtime = statSync(normalizedPath).mtimeMs;
  if (_indexCache && _indexPath === normalizedPath && _indexMtimeMs === mtime) {
    return _indexCache;
  }

  const { entities } = readBrain(brainPath);
  const index = new Map();
  const bizTypes = new Set(['biz-rule', 'biz-flow']);

  for (const [name, entity] of entities) {
    if (!bizTypes.has(entity.entityType)) continue;
    const observations = entity.observations || [];
    for (const obs of observations) {
      const raw = obsText(obs);
      const parsed = parseObservation(raw);
      const files = parseFilesObservation(parsed.text);
      for (const filePath of files) {
        if (!index.has(filePath)) index.set(filePath, []);
        index.get(filePath).push({
          name,
          entityType: entity.entityType,
          observation: raw,
          confidence: parsed.confidence,
        });
      }
    }
  }

  _indexCache = index;
  _indexMtimeMs = mtime;
  _indexPath = normalizedPath;
  return index;
}

/**
 * Enrich a blast radius result with matched KG business rules and flows.
 * @param {{ target: object|null, d1: object[], d2: object[], d3: object[] }} impactResult
 * @param {string} brainPath
 * @returns {{ rules: object[], flows: object[] }}
 */
export function enrichImpact(impactResult, brainPath) {
  const index = buildFileRuleIndex(brainPath);
  if (index.size === 0) return { rules: [], flows: [] };

  // Collect affected files with their depth
  const fileDepths = new Map(); // normalizedPath → minDepth
  const addFile = (file, depth) => {
    if (!file) return;
    const norm = normalizeFilePath(file);
    if (!fileDepths.has(norm) || fileDepths.get(norm) > depth) {
      fileDepths.set(norm, depth);
    }
  };

  if (impactResult.target) addFile(impactResult.target.file, 0);
  for (const s of impactResult.d1 || []) addFile(s.file, 1);
  for (const s of impactResult.d2 || []) addFile(s.file, 2);
  for (const s of impactResult.d3 || []) addFile(s.file, 3);

  // Match files against index
  const matched = new Map(); // entityName → best match (lowest depth)
  for (const [filePath, depth] of fileDepths) {
    const refs = index.get(filePath);
    if (!refs) continue;
    for (const ref of refs) {
      const existing = matched.get(ref.name);
      if (!existing || existing.depth > depth) {
        matched.set(ref.name, { ...ref, matchedFile: filePath, depth });
      }
    }
  }

  // Split into rules and flows
  const rules = [];
  const flows = [];
  for (const entry of matched.values()) {
    if (entry.entityType === 'biz-rule') rules.push(entry);
    else if (entry.entityType === 'biz-flow') flows.push(entry);
  }

  // Sort by depth (most critical first), then confidence
  const sortFn = (a, b) => a.depth - b.depth || b.confidence - a.confidence;
  rules.sort(sortFn);
  flows.sort(sortFn);

  return { rules, flows };
}
