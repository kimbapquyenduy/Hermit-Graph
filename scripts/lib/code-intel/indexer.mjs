/**
 * Code indexer — full + incremental indexing via git diff detection.
 * Parses files, extracts symbols/relations, writes to code-symbols.jsonl.
 */

import { readFileSync, readdirSync, statSync, promises as fsp } from 'fs';
import { join, relative, extname } from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { parseFile, isSupported, ensurePythonLoaded, ensureJavaLoaded } from './parser.mjs';
import { extractAll } from './extractor.mjs';
import { CodeGraph } from './graph.mjs';
import { readCodeGraph, writeCodeGraph, invalidateCache } from './code-io.mjs';
import { isMybatisMapper, extractMybatisMapper } from './extractor-mybatis-xml.mjs';
import { isVueSfc, extractVueSfc } from './extractor-vue-sfc.mjs';
import { isSvelteSfc, extractSvelteSfc } from './extractor-svelte-sfc.mjs';
import { isLiquid, extractLiquid } from './extractor-liquid.mjs';
import { runFrameworkPass } from './framework-scanner.mjs';
import { ParsePool } from './parse-pool.mjs';

// Phase 05 lite — parallel file I/O batching. CPU-bound ast-grep parsing
// stays sequential (single-threaded); only reads are parallelized.
const FILE_IO_BATCH_SIZE = 10;

/**
 * Read files in batches concurrently, yielding {file, source} pairs.
 * Skips unreadable files (>500KB cap, permission errors, binaries).
 */
async function* batchedReads(projectRoot, files) {
  for (let i = 0; i < files.length; i += FILE_IO_BATCH_SIZE) {
    const batch = files.slice(i, i + FILE_IO_BATCH_SIZE);
    const reads = await Promise.all(batch.map(async (file) => {
      try {
        const stat = await fsp.stat(join(projectRoot, file));
        if (stat.size > 500_000) return null;
        const source = await fsp.readFile(join(projectRoot, file), 'utf-8');
        return { file, source };
      } catch { return null; }
    }));
    for (const r of reads) if (r) yield r;
  }
}

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

  // Phase 05 — worker pool parses files in a dedicated thread with periodic
  // recycling. OPT-IN via HERMIT_PARSE_WORKER=1. Default is main-thread sync
  // because the serial-await pattern adds IPC overhead per file that exceeds
  // the parallelism benefit on small-to-medium repos. Worker mode helps when
  // memory isolation matters or the parser is producing large heap pressure.
  const useWorker = process.env.HERMIT_PARSE_WORKER === '1';
  let _pool = null;

  // Pass 1: extract symbols from all files (build global symbol map)
  const globalSymbolMap = new Map();
  const fileResults = [];

  // XML results held separately — XML extraction is single-pass (not AST-based)
  const xmlResults = [];

  // Phase 05 lite — batched async reads, sequential parse.
  let i = 0;
  for await (const { file, source } of batchedReads(projectRoot, files)) {
    i++;
    // XML branch — currently only MyBatis mappers
    if (file.toLowerCase().endsWith('.xml')) {
      if (isMybatisMapper(source)) {
        const { symbols, relations } = extractMybatisMapper(source, file);
        for (const s of symbols) globalSymbolMap.set(s.name, s.id);
        xmlResults.push({ symbols, relations });
      }
      opts.onProgress?.(file, i, files.length);
      continue;
    }

    // Vue SFC branch — extract component + members from .vue files.
    // Treated like XML: single-pass extraction, no AST.
    if (isVueSfc(file)) {
      const { symbols, relations } = extractVueSfc(source, file);
      for (const s of symbols) globalSymbolMap.set(s.name, s.id);
      xmlResults.push({ symbols, relations });
      opts.onProgress?.(file, i, files.length);
      continue;
    }

    // Svelte SFC branch — same shape as Vue.
    if (isSvelteSfc(file)) {
      const { symbols, relations } = extractSvelteSfc(source, file);
      for (const s of symbols) globalSymbolMap.set(s.name, s.id);
      xmlResults.push({ symbols, relations });
      opts.onProgress?.(file, i, files.length);
      continue;
    }

    // Liquid (Shopify) branch — single-pass template extraction.
    if (isLiquid(file)) {
      const { symbols, relations } = extractLiquid(source, file);
      for (const s of symbols) globalSymbolMap.set(s.name, s.id);
      xmlResults.push({ symbols, relations });
      opts.onProgress?.(file, i, files.length);
      continue;
    }

    // AST branch — JS/TS/Python/Java via ast-grep. Offload to worker pool
    // unless HERMIT_PARSE_WORKER=0 (escape hatch — runs in main thread).
    if (!_pool && useWorker) {
      _pool = new ParsePool();
    }
    if (useWorker) {
      const res = await _pool.extractSymbols(file, source);
      const symbols = res.symbols || [];
      for (const s of symbols) globalSymbolMap.set(s.name, s.id);
      fileResults.push({ file, source, symbols });
    } else {
      const parsed = parseFile(file, source);
      if (!parsed) continue;
      const { symbols } = extractAll(parsed.root, file, parsed.langStr);
      for (const s of symbols) globalSymbolMap.set(s.name, s.id);
      fileResults.push({ file, source, parsed, symbols });
    }
    opts.onProgress?.(file, i, files.length);
  }

  // Pass 2: extract relations with global symbol map for cross-file call resolution
  for (const fr of fileResults) {
    let relations;
    if (useWorker) {
      const res = await _pool.extractRelations(fr.file, fr.source, globalSymbolMap);
      relations = res.relations || [];
    } else {
      const r = extractAll(fr.parsed.root, fr.file, fr.parsed.langStr, globalSymbolMap);
      relations = r.relations;
    }
    graph.addSymbols(fr.symbols);
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

  // Phase 05 — release worker before framework pass (it's regex-only, no parsing).
  if (_pool) {
    try { await _pool.shutdown(); } catch {}
    _pool = null;
  }

  // Phase 03 wave 2 — framework post-pass. Adds RENDERS / framework-resolved
  // CALLS edges that the AST extractor misses (JSX, Laravel dispatch, etc.).
  // No-op when no framework is detected.
  let frameworkStats = { active: [], added: 0, byFramework: {} };
  try {
    frameworkStats = await runFrameworkPass(projectRoot, files, graph);
  } catch (err) {
    // Framework pass is opportunistic — never block indexing on failure.
    opts.onProgress?.(`framework-pass error: ${err.message}`, files.length, files.length);
  }

  graph.meta.commit = getHeadCommit(projectRoot);
  // Phase 01 — capture content hashes for non-git change detection fallback.
  const { newHashes } = getChangedFilesByHash(projectRoot, {});
  graph.meta.fileHashes = newHashes;
  graph.meta.frameworks = frameworkStats.active;
  await writeCodeGraph(dataDir, graph);

  return {
    graph,
    stats: {
      files: files.length,
      symbols: graph.symbols.size,
      relations: graph.relations.length,
      frameworks: frameworkStats,
    },
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

  let changed = getChangedFiles(projectRoot, lastCommit);
  // Phase 01 — when git diff fails (commit lost, non-git dir), fall back to
  // content-hash sync instead of always full-reindexing.
  if (changed === null) {
    if (graph.meta.fileHashes && Object.keys(graph.meta.fileHashes).length > 0) {
      const hashResult = getChangedFilesByHash(projectRoot, graph.meta.fileHashes);
      changed = hashResult.changed;
      // Update hashes for next round; we'll persist these below.
      graph.meta.fileHashes = hashResult.newHashes;
    } else {
      // No prior hashes — full reindex
      return { ...(await fullIndex(projectRoot, dataDir)), changed: [] };
    }
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

/**
 * Phase 01 — content-hash change detection.
 *
 * Universal fallback when git diff fails (non-git dir, force-push, rebase).
 * Computes sha256 of each supported file and compares against stored hashes
 * in graph.meta.fileHashes. Returns the list of changed/new files.
 *
 * Hashing 598-file medium project takes ~150ms on commodity hw — bounded by
 * 500KB per-file cap in safeRead.
 *
 * @param {string} projectRoot
 * @param {Record<string, string>} oldHashes
 * @returns {{ changed: string[], newHashes: Record<string, string> }}
 */
export function getChangedFilesByHash(projectRoot, oldHashes = {}) {
  const files = collectFiles(projectRoot);
  const changed = [];
  const newHashes = {};
  for (const file of files) {
    const abs = join(projectRoot, file);
    const src = safeRead(abs);
    if (src === null) continue;
    const hash = createHash('sha256').update(src).digest('hex').slice(0, 16);
    newHashes[file] = hash;
    if (oldHashes[file] !== hash) changed.push(file);
  }
  // Files that disappeared (in old, not in new) are also "changed".
  for (const file of Object.keys(oldHashes)) {
    if (!Object.prototype.hasOwnProperty.call(newHashes, file)) changed.push(file);
  }
  return { changed, newHashes };
}
