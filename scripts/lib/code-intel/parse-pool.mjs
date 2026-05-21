/**
 * Phase 05 — parse-pool orchestrator (single worker + recycling).
 *
 * Owns one worker thread that handles parse + extract messages. Recycles the
 * worker every RECYCLE_AFTER parses (terminate → respawn) to bound native
 * heap growth on long-running indexing jobs. Per-request timeout + crash
 * recovery so a pathological file never wedges the indexer.
 *
 * Single worker (not pool of N) is intentional KISS — multi-worker would
 * fragment the globalSymbolMap consistency. The benefit here is memory
 * isolation + pipelined I/O overlap (main reads next file while worker
 * parses current one).
 *
 * Use:
 *   const pool = new ParsePool();
 *   const { symbols, langStr } = await pool.extractSymbols(file, source);
 *   const { relations }         = await pool.extractRelations(file, source, globalSymbolMap);
 *   await pool.shutdown();
 */

import { Worker } from 'worker_threads';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { cpus } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Worker constructor accepts a URL object (not a URL string); needed on Windows.
const WORKER_PATH = pathToFileURL(join(__dirname, 'parse-worker.mjs'));

const RECYCLE_AFTER       = Number(process.env.HERMIT_PARSE_RECYCLE || 500);
const PARSE_TIMEOUT_BASE  = 30_000;
const DEFAULT_WORKER_COUNT = Math.max(2, Math.min(8, Math.floor(cpus().length / 2)));

function timeoutFor(sourceLen) {
  return PARSE_TIMEOUT_BASE + Math.floor(sourceLen / 100_000) * 10_000;
}

/**
 * Stable hash → worker index. Same file always routes to same worker so its
 * AST stays cached in pass-2.
 */
function hashFile(file, count) {
  let h = 0;
  for (let i = 0; i < file.length; i++) h = ((h << 5) - h + file.charCodeAt(i)) | 0;
  return Math.abs(h) % count;
}

export class ParsePool {
  constructor({ recycleAfter = RECYCLE_AFTER, workerCount = DEFAULT_WORKER_COUNT } = {}) {
    this.recycleAfter = recycleAfter;
    this.workerCount = Math.max(1, workerCount);
    this.workers = new Array(this.workerCount).fill(null);
    this.pending = new Array(this.workerCount).fill(null).map(() => new Map());
    this.parseCounts = new Array(this.workerCount).fill(0);
    this.nextId = 1;
    this.shuttingDown = false;
    for (let i = 0; i < this.workerCount; i++) this._spawn(i);
  }

  _spawn(idx) {
    const w = new Worker(WORKER_PATH);
    w.on('message', (msg) => this._onMessage(idx, msg));
    w.on('error', (err) => this._onCrash(idx, err));
    w.on('exit', (code) => {
      if (this.shuttingDown) return;
      if (code !== 0) this._onCrash(idx, new Error(`worker exit ${code}`));
    });
    this.workers[idx] = w;
  }

  _onMessage(idx, msg) {
    const m = this.pending[idx];
    const cb = m.get(msg.id);
    if (!cb) return;
    m.delete(msg.id);
    if (msg.ok) cb.resolve(msg);
    else cb.reject(new Error(msg.error || 'worker error'));
  }

  _onCrash(idx, err) {
    for (const [, cb] of this.pending[idx]) {
      cb.reject(new Error(`worker[${idx}] crash: ${err.message}`));
    }
    this.pending[idx].clear();
    if (!this.shuttingDown) this._spawn(idx);
  }

  async _maybeRecycle(idx) {
    if (this.parseCounts[idx] < this.recycleAfter) return;
    if (this.pending[idx].size > 0) return;
    try { await this.workers[idx].terminate(); } catch {}
    this.parseCounts[idx] = 0;
    this._spawn(idx);
  }

  async _request(idx, payload, sourceLen = 0) {
    await this._maybeRecycle(idx);
    const id = this.nextId++;
    this.parseCounts[idx]++;
    const tMs = timeoutFor(sourceLen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending[idx].delete(id);
        reject(new Error(`parse timeout after ${tMs}ms`));
      }, tMs);
      this.pending[idx].set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      });
      this.workers[idx].postMessage({ id, ...payload });
    });
  }

  /**
   * Pass-1: parse + extract symbols. AST cached in this file's assigned
   * worker for pass-2 cache hit.
   */
  extractSymbols(file, source) {
    const idx = hashFile(file, this.workerCount);
    return this._request(idx, { type: 'extract-symbols', file, source }, source.length);
  }

  /**
   * Pass-2: extract relations against a global symbol map. Routes to the
   * SAME worker that handled pass-1 so the cached AST is reused. If the
   * map was preloaded via preloadSymbols, we skip resending it per file.
   */
  extractRelations(file, source, symbolMap) {
    const idx = hashFile(file, this.workerCount);
    const payload = { type: 'extract-relations', file, source };
    if (!this._symbolsPreloaded) payload.symbolMapEntries = [...symbolMap.entries()];
    return this._request(idx, payload, source.length);
  }

  /**
   * Send the global symbol map to every worker once. Subsequent
   * extractRelations calls skip the per-file map send — huge win on
   * large repos (avoids serializing ~1MB × N files of map data).
   */
  async preloadSymbols(symbolMap) {
    const entries = [...symbolMap.entries()];
    await Promise.all(this.workers.map((_, i) =>
      this._request(i, { type: 'preload-symbols', symbolMapEntries: entries }, 0)
    ));
    this._symbolsPreloaded = true;
  }

  dropCache(file) {
    const idx = hashFile(file, this.workerCount);
    return this._request(idx, { type: 'drop-cache', file }, 0);
  }

  /** Graceful shutdown — terminates all workers in parallel. */
  async shutdown() {
    this.shuttingDown = true;
    for (let i = 0; i < this.workerCount; i++) {
      for (const [, cb] of this.pending[i]) cb.reject(new Error('shutdown'));
      this.pending[i].clear();
    }
    await Promise.all(this.workers.map(w => w?.terminate().catch(() => {})));
  }
}
