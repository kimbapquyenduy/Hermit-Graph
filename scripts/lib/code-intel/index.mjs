/**
 * Code Intelligence — public API facade.
 * Replaces GitNexus with built-in ast-grep-powered code analysis.
 * 5 capabilities: query, context, impact, detect_changes, index.
 */

export { parseFile, isSupported, hasPython } from './parser.mjs';
export { extractAll } from './extractor.mjs';
export { CodeGraph } from './graph.mjs';
export { readCodeGraph, writeCodeGraph, clearCodeGraph, codeGraphPath } from './code-io.mjs';
export { fullIndex, incrementalIndex, detectChanges } from './indexer.mjs';
export { blastRadius, symbolContext } from './impact.mjs';
export { detectProcesses } from './process-detector.mjs';

import { readCodeGraph } from './code-io.mjs';
import { fullIndex, incrementalIndex, detectChanges } from './indexer.mjs';
import { blastRadius, symbolContext } from './impact.mjs';
import { detectProcesses } from './process-detector.mjs';

/**
 * High-level API matching the 5 MCP tool signatures.
 * Designed as drop-in replacement for gitnexus-runner.mjs.
 */

/**
 * Query — find symbols by concept/name.
 * @param {string} query — search term
 * @param {string} dataDir — data directory path
 * @returns {{ symbols: object[], processes: object[] }}
 */
export function query(queryStr, dataDir) {
  const graph = readCodeGraph(dataDir);
  const symbols = graph.searchSymbols(queryStr);
  const processes = detectProcesses(graph).filter(p =>
    p.label.toLowerCase().includes(queryStr.toLowerCase()) ||
    p.steps.some(s => s.name.toLowerCase().includes(queryStr.toLowerCase()))
  );
  return { symbols: symbols.slice(0, 20), processes: processes.slice(0, 10) };
}

/**
 * Context — 360-degree view of a symbol.
 * @param {string} name — symbol name or ID
 * @param {string} dataDir
 * @returns {{ symbol: object, callers: object[], callees: object[], relations: object[] }}
 */
export function context(name, dataDir) {
  const graph = readCodeGraph(dataDir);
  return symbolContext(graph, name);
}

/**
 * Impact — blast radius analysis.
 * @param {string} target — symbol name or ID
 * @param {'upstream'|'downstream'|'both'} direction
 * @param {string} dataDir
 * @returns {{ target: object, d1: object[], d2: object[], d3: object[], summary: string }}
 */
export function impact(target, direction, dataDir) {
  const graph = readCodeGraph(dataDir);
  return blastRadius(graph, target, direction);
}

/**
 * Detect changes — check if index is stale.
 * @param {string} projectRoot
 * @param {string} dataDir
 */
export function changes(projectRoot, dataDir) {
  return detectChanges(projectRoot, dataDir);
}

/**
 * Index — full or incremental project indexing.
 * Auto-detects: if previous index exists, does incremental; otherwise full.
 * @param {string} projectRoot
 * @param {string} dataDir
 * @param {object} [opts]
 * @returns {Promise<{ stats: object, changed?: string[] }>}
 */
export async function index(projectRoot, dataDir, opts = {}) {
  const graph = readCodeGraph(dataDir);
  if (graph.meta.commit) {
    return incrementalIndex(projectRoot, dataDir);
  }
  return fullIndex(projectRoot, dataDir, opts);
}
