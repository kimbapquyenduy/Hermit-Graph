/**
 * mcp-client-pool.mjs — Manages a pool of MCP client connections.
 *
 * Lifecycle per bridge:
 *   add() → connect → ready
 *   crash → restart (3 retries: 1s, 2s, 4s backoff) → dead
 *   remove() / shutdownAll() → graceful close
 *
 * Uses @modelcontextprotocol/sdk Client + createTransport().
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createTransport } from './transport-factory.mjs';

/** @typedef {'connecting'|'ready'|'restarting'|'dead'} BridgeStatus */

/**
 * @typedef {Object} BridgeState
 * @property {BridgeStatus} status
 * @property {Client|null} client
 * @property {import('./transport-factory.mjs').BridgeConfig} config
 * @property {string|null} lastError
 * @property {number} restartAttempts
 * @property {Array<{name:string,description?:string,inputSchema?:object}>|null} toolsCache
 * @property {number} toolsCacheAt
 */

const CACHE_TTL_MS = 60_000;
const BACKOFF_MS = [1000, 2000, 4000];
const MAX_RESTARTS = 3;

export class McpClientPool {
  constructor() {
    /** @type {Map<string, BridgeState>} */
    this._bridges = new Map();
  }

  /**
   * Add a bridge: spawn/connect, handshake, mark ready.
   * Non-blocking — returns once initial connect attempt is done or rejects.
   *
   * @param {import('./transport-factory.mjs').BridgeConfig} config
   * @returns {Promise<void>}
   */
  async add(config) {
    if (this._bridges.has(config.name)) {
      throw new Error(`bridge '${config.name}' already exists; remove() first`);
    }
    /** @type {BridgeState} */
    const state = {
      status: 'connecting',
      client: null,
      config,
      lastError: null,
      restartAttempts: 0,
      toolsCache: null,
      toolsCacheAt: 0,
    };
    this._bridges.set(config.name, state);
    await this._connect(state);
  }

  /**
   * List tools for a bridge, with 60s cache.
   *
   * @param {string} name
   * @returns {Promise<Array<{name:string,description?:string,inputSchema?:object}>>}
   */
  async listTools(name) {
    const state = this._getReady(name);
    const now = Date.now();
    if (state.toolsCache && now - state.toolsCacheAt < CACHE_TTL_MS) {
      return state.toolsCache;
    }
    const result = await state.client.listTools();
    state.toolsCache = result.tools || [];
    state.toolsCacheAt = now;
    return state.toolsCache;
  }

  /**
   * Call a tool on a bridge.
   *
   * @param {string} name - Bridge name
   * @param {string} toolName - Original tool name
   * @param {Record<string,unknown>} args
   * @returns {Promise<unknown>}
   */
  async callTool(name, toolName, args) {
    const state = this._getReady(name);
    return state.client.callTool({ name: toolName, arguments: args });
  }

  /**
   * Gracefully close one bridge.
   *
   * @param {string} name
   */
  async remove(name) {
    const state = this._bridges.get(name);
    if (!state) return;
    this._bridges.delete(name);
    if (state.client) {
      try { await state.client.close(); } catch { /* ignore close errors */ }
    }
  }

  /**
   * Shut down all bridges — called on SIGINT/SIGTERM.
   * Completes within 2s (uses Promise.allSettled).
   */
  async shutdownAll() {
    const names = [...this._bridges.keys()];
    await Promise.allSettled(names.map(n => this.remove(n)));
  }

  /**
   * Return per-bridge status summary.
   * @returns {Array<{name:string, status:BridgeStatus, lastError:string|null, restartAttempts:number}>}
   */
  getStatuses() {
    return [...this._bridges.entries()].map(([name, s]) => ({
      name,
      status: s.status,
      lastError: s.lastError,
      restartAttempts: s.restartAttempts,
    }));
  }

  /**
   * Get state or throw if not ready.
   * @param {string} name
   * @returns {BridgeState}
   */
  _getReady(name) {
    const state = this._bridges.get(name);
    if (!state) throw new Error(`bridge '${name}' not found`);
    if (state.status !== 'ready') {
      throw new Error(`bridge '${name}' is not ready (status: ${state.status})`);
    }
    return state;
  }

  /**
   * Connect a bridge state. On disconnect, schedule restart.
   * @param {BridgeState} state
   */
  async _connect(state) {
    const { name } = state.config;
    try {
      const transport = createTransport(state.config);

      // Capture stderr for stdio transports
      if (transport.stderr) {
        transport.stderr.on('data', (chunk) => {
          process.stderr.write(`[bridge:${name}] ${chunk}`);
        });
      }

      const client = new Client({ name: `hermit-bridge-${name}`, version: '1.0.0' });

      // Listen for close to schedule restart
      transport.onclose = () => {
        if (!this._bridges.has(name)) return; // removed intentionally
        const s = this._bridges.get(name);
        if (s && s.status === 'ready') {
          this._scheduleRestart(s);
        }
      };

      await client.connect(transport);

      state.client = client;
      state.status = 'ready';
      state.lastError = null;
      state.toolsCache = null; // invalidate on reconnect
    } catch (err) {
      state.lastError = err.message;
      this._scheduleRestart(state);
    }
  }

  /**
   * Schedule restart with exponential backoff. After MAX_RESTARTS → mark dead.
   * @param {BridgeState} state
   */
  _scheduleRestart(state) {
    const { name } = state.config;
    if (state.restartAttempts >= MAX_RESTARTS) {
      state.status = 'dead';
      process.stderr.write(
        `[bridge:${name}] WARNING: bridge marked dead after ${MAX_RESTARTS} restart attempts (last error: ${state.lastError})\n`
      );
      return;
    }
    const delay = BACKOFF_MS[state.restartAttempts] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    state.restartAttempts++;
    state.status = 'restarting';
    process.stderr.write(`[bridge:${name}] restarting (attempt ${state.restartAttempts}/${MAX_RESTARTS}) in ${delay}ms\n`);
    setTimeout(() => {
      if (!this._bridges.has(name)) return; // removed while waiting
      this._connect(state).catch(() => {}); // errors handled inside _connect
    }, delay);
  }
}
