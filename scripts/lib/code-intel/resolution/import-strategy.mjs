/**
 * Phase 03 — import-based resolution strategy.
 *
 * Sits between framework-strategy (high-confidence regex matches) and
 * name-strategy (universal fallback). When a reference name was imported
 * into the source file, prefer the symbol that lives in the imported file
 * over a global name match. Cuts cross-file ambiguity dramatically.
 *
 * Context shape:
 *   ctx.importMap : Map<file, Map<localName, modulePath>>
 *     Pre-built during pass-1 alongside symbol extraction.
 *
 * Without an importMap, this strategy returns null (cascade falls through
 * to name-strategy).
 */

import { pickBest } from './scoring.mjs';

/**
 * Resolve a relative module path against the importer's file using manual
 * segment math (cross-platform — avoids path.resolve drive-letter quirks
 * on Windows).
 *   importerFile = src/components/Button.tsx
 *   modulePath   = ./utils       → src/components/utils
 *   modulePath   = ../lib/foo    → src/lib/foo
 */
function resolveModulePath(importerFile, modulePath) {
  if (!modulePath || !modulePath.startsWith('.')) return null; // bare specifier
  const baseSegments = importerFile.replace(/\\/g, '/').split('/').slice(0, -1); // drop filename
  const modSegments = modulePath.replace(/\\/g, '/').split('/');
  for (const seg of modSegments) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') baseSegments.pop();
    else baseSegments.push(seg);
  }
  return baseSegments.join('/');
}

/**
 * Pick the symbol whose file most closely matches a resolved module path.
 * Tries common extensions and index.* file patterns.
 */
function findInResolvedModule(graph, refName, resolvedPath) {
  const candidates = graph.findByName(refName);
  if (!candidates.length) return null;
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.java'];
  const indexFiles = ['index.ts', 'index.js', 'index.tsx', 'index.jsx', 'index.mjs'];
  const prefixes = [
    resolvedPath,
    ...exts.map(e => resolvedPath + e),
    ...indexFiles.map(idx => `${resolvedPath}/${idx}`),
  ];
  for (const p of prefixes) {
    const hit = candidates.find(c => c.file === p);
    if (hit) return hit;
  }
  // Fall back to: same directory tree as resolved path.
  return candidates.find(c => c.file.startsWith(resolvedPath));
}

/**
 * @param {object} ref       — UnresolvedReference (sourceId, referenceName, fromFile, …)
 * @param {object} ctx       — { graph, importMap, knownNames }
 * @returns {object|null}
 */
export function resolveByImport(ref, ctx) {
  if (!ctx.importMap || !ref.fromFile) return null;
  const fileImports = ctx.importMap.get(ref.fromFile);
  if (!fileImports) return null;

  const modulePath = fileImports.get(ref.referenceName);
  if (!modulePath) return null;

  const resolvedPath = resolveModulePath(ref.fromFile, modulePath);
  if (!resolvedPath) return null;

  const hit = findInResolvedModule(ctx.graph, ref.referenceName, resolvedPath);
  if (!hit) return null;

  return {
    sourceId: ref.sourceId,
    targetId: hit.id,
    kind: ref.referenceKind,
    confidence: 0.88, // strong but below 0.9 framework threshold — name match may still win on same-file
    resolvedBy: 'import',
  };
}

export const importStrategy = {
  name: 'import',
  resolve: resolveByImport,
};
