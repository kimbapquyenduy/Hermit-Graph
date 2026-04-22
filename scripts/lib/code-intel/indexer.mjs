/**
 * Code indexer — full + incremental indexing via git diff detection.
 * Parses files, extracts symbols/relations, writes to code-symbols.jsonl.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { execFileSync } from 'child_process';
import { parseFile, isSupported, ensurePythonLoaded, ensureJavaLoaded } from './parser.mjs';
import { extractAll } from './extractor.mjs';
import { CodeGraph } from './graph.mjs';
import { readCodeGraph, writeCodeGraph, invalidateCache } from './code-io.mjs';
import { isMybatisMapper, extractMybatisMapper } from './extractor-mybatis-xml.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hermit', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '.output', '__pycache__', '.venv', 'vendor',
]);

/**
 * Full index — parse all supported files in a project.
 * @param {string} projectRoot — absolute path to project root
 * @param {string} dataDir — where to write code-symbols.jsonl
 * @param {object} [opts]
 * @param {Function} [opts.onProgress] — callback(file, index, total)
 * @returns {Promise<{ graph: CodeGraph, stats: object }>}
 */
export async function fullIndex(projectRoot, dataDir, opts = {}) {
  await ensurePythonLoaded();
  await ensureJavaLoaded();
  const files = collectFiles(projectRoot);
  const graph = new CodeGraph();

  // Pass 1: extract symbols from all files (build global symbol map)
  const globalSymbolMap = new Map();
  const fileResults = [];

  // XML results held separately — XML extraction is single-pass (not AST-based)
  const xmlResults = [];

  for (let i = 0; i < files.length; i++) {
    const absPath = join(projectRoot, files[i]);
    const source = safeRead(absPath);
    if (!source) continue;

    // XML branch — currently only MyBatis mappers
    if (files[i].toLowerCase().endsWith('.xml')) {
      if (isMybatisMapper(source)) {
        const { symbols, relations } = extractMybatisMapper(source, files[i]);
        for (const s of symbols) globalSymbolMap.set(s.name, s.id);
        xmlResults.push({ symbols, relations });
      }
      opts.onProgress?.(files[i], i + 1, files.length);
      continue;
    }

    // AST branch — JS/TS/Python/Java via ast-grep
    const parsed = parseFile(files[i], source);
    if (!parsed) continue;
    const { symbols } = extractAll(parsed.root, files[i], parsed.langStr);
    for (const s of symbols) globalSymbolMap.set(s.name, s.id);
    fileResults.push({ file: files[i], parsed, symbols });
    opts.onProgress?.(files[i], i + 1, files.length);
  }

  // Pass 2: extract relations with global symbol map for cross-file call resolution
  for (const { file, parsed, symbols } of fileResults) {
    const { relations } = extractAll(parsed.root, file, parsed.langStr, globalSymbolMap);
    graph.addSymbols(symbols);
    graph.addRelations(relations);
  }

  // XML symbols + relations — cross-link MEMBER_OF target to Java class when available
  for (const { symbols, relations } of xmlResults) {
    graph.addSymbols(symbols);
    // Rewrite MEMBER_OF.to from short class name → Java symbol id if resolvable
    for (const rel of relations) {
      if (rel.kind === 'MEMBER_OF' && typeof rel.to === 'string' && !rel.to.includes('::')) {
        const resolved = globalSymbolMap.get(rel.to);
        if (resolved) rel.to = resolved;
      }
    }
    graph.addRelations(relations);
  }

  graph.meta.commit = getHeadCommit(projectRoot);
  await writeCodeGraph(dataDir, graph);

  return {
    graph,
    stats: { files: files.length, symbols: graph.symbols.size, relations: graph.relations.length },
  };
}

/**
 * Incremental index — re-parse only changed files since last index.
 * @param {string} projectRoot
 * @param {string} dataDir
 * @returns {Promise<{ graph: CodeGraph, changed: string[], stats: object }>}
 */
export async function incrementalIndex(projectRoot, dataDir) {
  await ensurePythonLoaded();
  await ensureJavaLoaded();
  invalidateCache(); // Force fresh read, prevent stale cache on write failure
  const graph = readCodeGraph(dataDir);
  const lastCommit = graph.meta.commit;

  if (!lastCommit) {
    // No previous index — do full index
    return { ...(await fullIndex(projectRoot, dataDir)), changed: [] };
  }

  const changed = getChangedFiles(projectRoot, lastCommit);
  if (changed === null) {
    // Commit no longer in history (force-push) — fall back to full index
    return { ...(await fullIndex(projectRoot, dataDir)), changed: [] };
  }
  if (changed.length === 0) {
    return { graph, changed: [], stats: { files: 0, symbols: 0, relations: 0 } };
  }

  // Remove old data for changed files
  for (const file of changed) graph.removeByFile(file);

  // Re-parse changed files
  const globalSymbolMap = new Map();
  for (const [name, s] of graph.symbols) globalSymbolMap.set(s.name, s.id);

  for (const file of changed) {
    const absPath = join(projectRoot, file);
    const source = safeRead(absPath);
    if (!source) continue; // file deleted
    const parsed = parseFile(file, source);
    if (!parsed) continue;
    const { symbols, relations } = extractAll(parsed.root, file, parsed.langStr, globalSymbolMap);
    graph.addSymbols(symbols);
    graph.addRelations(relations);
    for (const s of symbols) globalSymbolMap.set(s.name, s.id);
  }

  graph.meta.commit = getHeadCommit(projectRoot);
  await writeCodeGraph(dataDir, graph);

  return {
    graph, changed,
    stats: { files: changed.length, symbols: graph.symbols.size, relations: graph.relations.length },
  };
}

/**
 * Detect what changed since last index without reindexing.
 * @param {string} projectRoot
 * @param {string} dataDir
 * @returns {{ stale: boolean, changed: string[], lastCommit: string|null, currentCommit: string }}
 */
export function detectChanges(projectRoot, dataDir) {
  const graph = readCodeGraph(dataDir);
  const lastCommit = graph.meta.commit;
  const currentCommit = getHeadCommit(projectRoot);
  const changed = lastCommit ? getChangedFiles(projectRoot, lastCommit) : null;

  return {
    // stale when: no prior commit, commit vanished (null), or files changed
    stale: !lastCommit || changed === null || changed.length > 0,
    changed: changed ?? [],
    lastCommit,
    currentCommit,
    indexed: { files: graph.meta.files, symbols: graph.meta.symbols, relations: graph.meta.relations },
  };
}

// ── Helpers ──

function collectFiles(root, prefix = '') {
  const files = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      files.push(...collectFiles(root, rel));
    } else if (entry.isFile() && isSupported(entry.name)) {
      files.push(rel);
    }
  }
  return files;
}

function safeRead(absPath) {
  try {
    const stat = statSync(absPath);
    if (stat.size > 500_000) return null; // skip files >500KB
    return readFileSync(absPath, 'utf-8');
  } catch { return null; }
}

function getHeadCommit(projectRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, timeout: 5000 }).toString().trim();
  } catch { return null; }
}

/**
 * Returns changed files since sinceCommit, or null if commit no longer exists
 * (e.g. after a force-push). Callers must treat null as "trigger full reindex".
 */
function getChangedFiles(projectRoot, sinceCommit) {
  try {
    // Validate commit still exists in history before diffing
    execFileSync('git', ['cat-file', '-t', sinceCommit], { cwd: projectRoot, timeout: 5000 });
    const output = execFileSync('git', ['diff', '--name-only', `${sinceCommit}..HEAD`], {
      cwd: projectRoot, timeout: 10000,
    }).toString().trim();
    if (!output) return [];
    return output.split('\n').filter(f => isSupported(f));
  } catch { return null; } // null = commit not found or git error → trigger full reindex
}
