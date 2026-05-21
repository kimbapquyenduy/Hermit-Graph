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

const __dirname = dirname(fileURLToPath(import.meta.url));
// Worker constructor accepts a URL object (not a URL string); needed on Windows.
const WORKER_PATH = pathToFileURL(join(__dirname, 'parse-worker.mjs'));

const RECYCLE_AFTER       = Number(process.env.HERMIT_PARSE_RECYCLE || 500);
const PARSE_TIMEOUT_BASE  = 30_000;        // 30s base
const PARSE_TIMEOUT_PER_K = 10_000 / 1024; // +10s per ~100KB of source

function timeoutFor(sourceLen) {
  return PARSE_TIMEOUT_BASE + Math.floor(sourceLen / 100_000) * 10_000;
}

export class ParsePool {
  constructor({ recycleAfter = RECYCLE_AFTER } = {}) {
    this.recycleAfter = recycleAfter;
    this.parseCount = 0;
    this.nextId = 1;
    this.pending = new Map();
    this.shuttingDown = false;
    this._spawn();
  }

  _spawn() {
    this.worker = new Worker(WORKER_PATH);
    this.worker.on('message', (msg) => this._onMessage(msg));
    this.worker.on('error', (err) => this._onCrash(err));
    this.worker.on('exit', (code) => {
      if (this.shuttingDown) return;
      if (code !== 0) this._onCrash(new Error(`worker exit ${code}`));
    });
  }

  _onMessage(msg) {
    const cb = this.pending.get(msg.id);
    if (!cb) return;
    this.pending.delete(msg.id);
    if (msg.ok) cb.resolve(msg);
    else cb.reject(new Error(msg.error || 'worker error'));
  }

  _onCrash(err) {
    // Reject every in-flight request, then spawn fresh worker for future ones.
    for (const [id, cb] of this.pending) {
      cb.reject(new Error(`worker crash: ${err.message}`));
    }
    this.pending.clear();
    if (!this.shuttingDown) this._spawn();
  }

  async _maybeRecycle() {
    if (this.parseCount < this.recycleAfter) return;
    if (this.pending.size > 0) return; // wait for in-flight to drain
    try { await this.worker.terminate(); } catch {}
    this.parseCount = 0;
    this._spawn();
  }

  async _request(payload, sourceLen = 0) {
    await this._maybeRecycle();
    const id = this.nextId++;
    this.parseCount++;
    const tMs = timeoutFor(sourceLen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`parse timeout after ${tMs}ms`));
      }, tMs);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      });
      this.worker.postMessage({ id, ...payload });
    });
  }

  /**
   * Pass-1: parse + extract symbols. AST cached in worker for pass-2.
   * @returns {Promise<{ symbols: object[], langStr: string|null }>}
   */
  extractSymbols(file, source) {
    return this._request({ type: 'extract-symbols', file, source }, source.length);
  }

  /**
   * Pass-2: extract relations against a global symbol map. Uses cached AST
   * if pass-1 ran first; otherwise re-parses (cache-miss safe).
   * @returns {Promise<{ relations: object[] }>}
   */
  extractRelations(file, source, symbolMap) {
    return this._request({
      type: 'extract-relations',
      file, source,
      symbolMapEntries: [...symbolMap.entries()],
    }, source.length);
  }

  /** Free cached AST for a file (rarely needed; pass-2 auto-drops). */
  dropCache(file) {
    return this._request({ type: 'drop-cache', file }, 0);
  }

  /** Graceful shutdown. Resolves once worker thread has exited. */
  async shutdown() {
    this.shuttingDown = true;
    for (const [id, cb] of this.pending) cb.reject(new Error('shutdown'));
    this.pending.clear();
    try { await this.worker.terminate(); } catch {}
  }
}
