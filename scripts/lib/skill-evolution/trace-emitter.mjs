/**
 * trace-emitter.mjs — TraceEmitter: EventEmitter + ring buffer + optional JSONL file sink.
 *
 * Only instantiated when HERMIT_TRACE_BUS=1. All tap points guard with:
 *   if (ctx.traceBus) ctx.traceBus.emit(type, data)
 * so zero overhead when disabled.
 *
 * @module trace-emitter
 */

import { EventEmitter } from 'events';
import { createWriteStream } from 'fs';
import { validateEvent, TRACE_SCHEMA_VERSION } from './trace-schema.mjs';

/**
 * TraceEmitter — collects execution trace events into a bounded ring buffer.
 * Optionally writes events to an append-only JSONL file.
 *
 * @extends {EventEmitter}
 */
export class TraceEmitter extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.ringSize=1000] - Max events retained in memory (older dropped)
   * @param {string|null} [opts.sinkPath=null] - File path for append-only JSONL sink
   */
  constructor({ ringSize = 1000, sinkPath = null } = {}) {
    super();
    if (!Number.isInteger(ringSize) || ringSize < 1) {
      throw new RangeError(`ringSize must be a positive integer, got ${ringSize}`);
    }
    /** @private */
    this._ringSize = ringSize;
    /** @private @type {object[]} */
    this._buffer = [];
    /** @private @type {import('fs').WriteStream|null} */
    this._sink = null;
    /** @private */
    this._sinkPath = sinkPath;
    /** @private */
    this._sinkReady = false;
    /** @private */
    this._sinkError = null;

    if (sinkPath) {
      this._openSink(sinkPath);
    }
  }

  /**
   * Open the file sink for append-only JSONL writes.
   * Errors are captured and logged to stderr; they never throw to callers.
   * @private
   * @param {string} filePath
   */
  _openSink(filePath) {
    try {
      this._sink = createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
      this._sink.once('ready', () => { this._sinkReady = true; });
      this._sink.once('error', (err) => {
        this._sinkError = err;
        this._sinkReady = false;
        process.stderr.write(`[hermit:trace] sink error: ${err.message}\n`);
      });
    } catch (err) {
      this._sinkError = err;
      process.stderr.write(`[hermit:trace] failed to open sink ${filePath}: ${err.message}\n`);
    }
  }

  /**
   * Emit a trace event. Overrides EventEmitter.emit for the trace path.
   *
   * - Timestamps the event (adds ts + schemaVersion if missing)
   * - Validates against frozen v1 schema (throws TypeError on invalid)
   * - Pushes to ring buffer (drops oldest when full)
   * - Writes to file sink if open
   * - Emits to EventEmitter subscribers
   *
   * Non-trace calls (e.g. 'error', 'newListener') pass through to super unchanged.
   *
   * @param {string} eventType
   * @param {object} data - Event payload (without ts/schemaVersion — added here)
   * @returns {boolean}
   */
  emit(eventType, data) {
    // Pass through Node internal events unmodified
    if (typeof data !== 'object' || data === null || eventType === 'error' || eventType === 'newListener' || eventType === 'removeListener') {
      return super.emit(eventType, data);
    }

    const event = {
      ...data,
      type: eventType,
      ts: data.ts ?? Date.now(),
      schemaVersion: TRACE_SCHEMA_VERSION,
    };

    // Validate — throws TypeError on schema violation
    validateEvent(event);

    // Ring buffer: push + drop oldest when full
    this._buffer.push(event);
    if (this._buffer.length > this._ringSize) {
      this._buffer.shift();
    }

    // File sink: best-effort append
    if (this._sink && this._sinkReady) {
      try {
        this._sink.write(JSON.stringify(event) + '\n');
      } catch (err) {
        // Non-fatal: log once then stop attempting
        if (!this._sinkError) {
          this._sinkError = err;
          process.stderr.write(`[hermit:trace] sink write error: ${err.message}\n`);
        }
      }
    }

    return super.emit(eventType, event);
  }

  /**
   * Get the N most recent events from the ring buffer.
   *
   * @param {number} [n=100] - Number of recent events to return (capped at ringSize)
   * @returns {object[]} Shallow copy of last N events (oldest first)
   */
  getRecent(n = 100) {
    const cap = Math.min(Math.max(1, n), this._ringSize);
    const start = Math.max(0, this._buffer.length - cap);
    return this._buffer.slice(start);
  }

  /**
   * Flush pending sink writes and close the file stream.
   * Resolves when the stream is fully closed.
   *
   * @returns {Promise<void>}
   */
  close() {
    return new Promise((resolve) => {
      if (!this._sink) {
        resolve();
        return;
      }
      this._sink.end(() => {
        this._sinkReady = false;
        resolve();
      });
    });
  }

  /**
   * Current buffer size (for testing / introspection).
   * @returns {number}
   */
  get bufferSize() {
    return this._buffer.length;
  }

  /**
   * Configured ring capacity.
   * @returns {number}
   */
  get ringSize() {
    return this._ringSize;
  }
}
