/**
 * Code indexer — full + incremental indexing via git diff detection.
 * Parses files, extracts symbols/relations, writes to code-symbols.jsonl.
 */

import { readFileSync, readdirSync, statSync, promises as fsp } from 'fs';
import { join, resolve } from 'path';
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
async function* batchedReads(projectRoot, files, opts = {}) {
  for (let i = 0; i < files.length; i += FILE_IO_BATCH_SIZE) {
    const batch = files.slice(i, i + FILE_IO_BATCH_SIZE);
    const reads = await Promise.all(batch.map(async (file) => {
      try {
        const stat = await fsp.stat(join(projectRoot, file));
        if (stat.size > 500_000) { if(opts.strict) throw new Error(`HERMIT_INDEX_FILE_LIMIT: ${file}`); return null; }
        const source = await fsp.readFile(join(projectRoot, file), 'utf-8');
        return { file, source };
      } catch (error) { if(opts.strict) throw error; return null; }
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
  const files = collectFiles(projectRoot, '', opts);
  const graph = new CodeGraph();

  // Phase 05 — worker pool parses files across N workers in parallel with
  // stable hash-routing so pass-2 hits each file's cached AST. Auto-enables
  // when the project has enough files to amortize worker startup (~340ms).
  // Override: HERMIT_PARSE_WORKER=1 forces on, =0 forces off.
  // Measured on EduMVP (547 files): worker ~2.7s vs sync ~4.6s (-42%).
  const _envWorker = process.env.HERMIT_PARSE_WORKER;
  const useWorker = opts.strict ? false : _envWorker === '1' ? true
                  : _envWorker === '0' ? false
                  : files.length >= 50;
  let _pool = null;

  // Pass 1: extract symbols from all files (build global symbol map)
  const globalSymbolMap = new Map();
  const fileResults = [];

  // XML results held separately — XML extraction is single-pass (not AST-based)
  const xmlResults = [];

  // Worker mode collects AST inputs here and dispatches them in parallel
  // via Promise.all after the read loop. Sync mode processes inline.
  const pendingAstInputs = [];

  // Phase 05 lite — batched async reads, sequential parse.
  let i = 0;
  for await (const { file, source } of batchedReads(projectRoot, files, opts)) {
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

    // AST branch — collect inputs; dispatch happens after the read loop so
    // worker mode can fan out across N workers via Promise.all.
    if (useWorker) {
      pendingAstInputs.push({ file, source });
    } else {
      const parsed = parseFile(file, source);
      if (!parsed) { if(opts.strict) throw new Error(`HERMIT_INDEX_PARSE_FAILED: ${file}`); continue; }
      if(opts.strict && parsed.root.find({rule:{kind:'ERROR'}})) throw new Error(`HERMIT_INDEX_PARSE_FAILED: ${file}`);
      const { symbols } = extractAll(parsed.root, file, parsed.langStr);
      for (const s of symbols) globalSymbolMap.set(s.name, s.id);
      fileResults.push({ file, source, parsed, symbols });
    }
    opts.onProgress?.(file, i, files.length);
  }

  // Worker mode: fan-out pass-1 across N workers (stable hash routes each
  // file to its assigned worker so pass-2 hits the cached AST).
  if (useWorker && pendingAstInputs.length) {
    _pool = new ParsePool();
    const pass1 = await Promise.all(pendingAstInputs.map(async ({ file, source }) => {
      try {
        const { symbols } = await _pool.extractSymbols(file, source);
        return { file, source, symbols: symbols || [] };
      } catch {
        return { file, source, symbols: [] };
      }
    }));
    for (const r of pass1) {
      for (const s of r.symbols) globalSymbolMap.set(s.name, s.id);
      fileResults.push(r);
    }
  }

  // Pass 2: extract relations with global symbol map for cross-file call resolution.
  // _pool exists only if at least one AST-parseable file was collected. A repo of
  // >=50 files that is 100% XML/Vue/Svelte/Liquid enables useWorker but never
  // allocates the pool — guard on _pool or pass-2 null-derefs on preloadSymbols.
  if (useWorker && _pool) {
    // Preload the symbol map into every worker once (saves serializing the
    // full map per file — big win on large repos with many symbols).
    await _pool.preloadSymbols(globalSymbolMap);
    // Parallel pass-2 via fan-out. Each file routes to same worker as pass-1.
    const pass2 = await Promise.all(fileResults.map(async (fr) => {
      try {
        const { relations } = await _pool.extractRelations(fr.file, fr.source, globalSymbolMap);
        return { fr, relations: relations || [] };
      } catch {
        return { fr, relations: [] };
      }
    }));
    for (const { fr, relations } of pass2) {
      graph.addSymbols(fr.symbols);
      graph.addRelations(relations);
    }
  } else {
    for (const fr of fileResults) {
      const r = extractAll(fr.parsed.root, fr.file, fr.parsed.langStr, globalSymbolMap);
      graph.addSymbols(fr.symbols);
      graph.addRelations(r.relations);
    }
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
    if(opts.strict) throw err;
    opts.onProgress?.(`framework-pass error: ${err.message}`, files.length, files.length);
  }

  graph.meta.commit = getHeadCommit(projectRoot);
  // Phase 01 — capture content hashes for non-git change detection fallback.
  const { newHashes } = getChangedFilesByHash(projectRoot, {}, opts);
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

  // Re-parse changed files. Use worker pool when enough changed files to
  // amortize worker startup (same heuristic as fullIndex).
  const globalSymbolMap = new Map();
  for (const [_n, s] of graph.symbols) globalSymbolMap.set(s.name, s.id);

  const _envWorker = process.env.HERMIT_PARSE_WORKER;
  const useWorker = _envWorker === '1' ? true
                  : _envWorker === '0' ? false
                  : changed.length >= 50;
  let _pool = null;

  if (useWorker) {
    _pool = new ParsePool();
    // Pass-1 fan-out for symbols.
    const pass1 = await Promise.all(changed.map(async (file) => {
      const source = safeRead(join(projectRoot, file));
      if (!source) return null;
      try {
        const { symbols } = await _pool.extractSymbols(file, source);
        return { file, source, symbols: symbols || [] };
      } catch { return null; }
    }));
    for (const r of pass1) {
      if (!r) continue;
      for (const s of r.symbols) globalSymbolMap.set(s.name, s.id);
    }
    // Pass-2 with preloaded map.
    await _pool.preloadSymbols(globalSymbolMap);
    const pass2 = await Promise.all(pass1.filter(Boolean).map(async (r) => {
      try {
        const { relations } = await _pool.extractRelations(r.file, r.source, globalSymbolMap);
        return { ...r, relations: relations || [] };
      } catch { return { ...r, relations: [] }; }
    }));
    for (const r of pass2) {
      graph.addSymbols(r.symbols);
      graph.addRelations(r.relations);
    }
    try { await _pool.shutdown(); } catch {}
  } else {
    for (const file of changed) {
      const source = safeRead(join(projectRoot, file));
      if (!source) continue;
      const parsed = parseFile(file, source);
      if (!parsed) continue;
      const { symbols, relations } = extractAll(parsed.root, file, parsed.langStr, globalSymbolMap);
      graph.addSymbols(symbols);
      graph.addRelations(relations);
      for (const s of symbols) globalSymbolMap.set(s.name, s.id);
    }
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

function collectFiles(root, prefix = '', opts = {}) {
  const files = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if(opts.excludePaths?.some(p=>resolve(p)===resolve(root,rel))) continue;
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      files.push(...collectFiles(root, rel, opts));
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
export function getChangedFilesByHash(projectRoot, oldHashes = {}, opts = {}) {
  const files = collectFiles(projectRoot, '', opts);
  const changed = [];
  const newHashes = {};
  for (const file of files) {
    const abs = join(projectRoot, file);
    const src = safeRead(abs);
    if (src === null) { if(opts.strict) throw new Error(`HERMIT_INDEX_UNREADABLE: ${file}`); continue; }
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
