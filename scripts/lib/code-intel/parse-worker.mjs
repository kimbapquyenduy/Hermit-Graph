/**
 * Phase 05 — parse worker thread.
 *
 * Handles parse + extract operations off the main thread so the main thread
 * can pipeline file I/O while the worker is busy parsing. The worker
 * recycles every N parses (managed by parse-pool) to bound native heap.
 *
 * Protocol (postMessage):
 *   { id, type: 'extract-symbols',  file, source }
 *     → { id, ok: true, symbols, langStr }   (parsed AST cached for pass-2)
 *
 *   { id, type: 'extract-relations', file, source, symbolMapEntries }
 *     → { id, ok: true, relations }          (uses cached AST when present)
 *
 *   { id, type: 'drop-cache', file }         (free cached AST early)
 *
 * Errors come back as { id, ok: false, error }.
 */

import { parentPort } from 'worker_threads';
import { parseFile, ensurePythonLoaded, ensureJavaLoaded } from './parser.mjs';
import { extractAll } from './extractor.mjs';

// AST cache keyed by file path. Pass-1 populates; pass-2 reads then deletes.
const cache = new Map();

// Preloaded symbol map for pass-2. Avoids re-sending full map with every
// extract-relations call. Pool sends one 'preload-symbols' message after
// pass-1 collects all symbols.
let preloadedSymbolMap = null;

async function init() {
  await ensurePythonLoaded();
  await ensureJavaLoaded();
}

const ready = init();

parentPort.on('message', async (msg) => {
  await ready;
  const { id, type } = msg;
  try {
    if (type === 'extract-symbols') {
      const parsed = parseFile(msg.file, msg.source);
      if (!parsed) {
        parentPort.postMessage({ id, ok: true, symbols: [], langStr: null });
        return;
      }
      const { symbols } = extractAll(parsed.root, msg.file, parsed.langStr);
      cache.set(msg.file, parsed);
      parentPort.postMessage({ id, ok: true, symbols, langStr: parsed.langStr });
      return;
    }

    if (type === 'extract-relations') {
      let parsed = cache.get(msg.file);
      if (!parsed) {
        // Cache miss — re-parse. Costs a parse but keeps correctness.
        parsed = parseFile(msg.file, msg.source);
      }
      if (!parsed) {
        parentPort.postMessage({ id, ok: true, relations: [] });
        return;
      }
      // Use preloaded map if available (saves serializing the map per call);
      // fall back to per-call map for back-compat when pool didn't preload.
      const symbolMap = preloadedSymbolMap || new Map(msg.symbolMapEntries || []);
      const { relations } = extractAll(parsed.root, msg.file, parsed.langStr, symbolMap);
      cache.delete(msg.file); // free AST once relations extracted
      parentPort.postMessage({ id, ok: true, relations });
      return;
    }

    if (type === 'preload-symbols') {
      preloadedSymbolMap = new Map(msg.symbolMapEntries || []);
      parentPort.postMessage({ id, ok: true });
      return;
    }

    if (type === 'drop-cache') {
      cache.delete(msg.file);
      parentPort.postMessage({ id, ok: true });
      return;
    }

    parentPort.postMessage({ id, ok: false, error: `unknown message type: ${type}` });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message });
  }
});
