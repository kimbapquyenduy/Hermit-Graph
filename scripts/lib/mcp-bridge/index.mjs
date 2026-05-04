/**
 * mcp-bridge/index.mjs — Single entry point for MCP bridge registration.
 *
 * Called from hermit-mcp-server.mjs as a standard module:
 *   const { register } = await import('./lib/mcp-bridge/index.mjs');
 *   register(server, context);
 *
 * Responsibilities:
 *   1. Discover bridge configs from disk
 *   2. For each enabled bridge: pool.add → listTools → registry.register
 *   3. registerNamespacedTools on the Brain server
 *   4. Register introspection tools: hermit_list_bridges, hermit_reload_bridges, hermit_enable_bridge
 *   5. Attach bridgePool/bridgeRegistry/bridgeBreaker to ctx for downstream phases
 */

import { z } from 'zod';
import { McpClientPool } from './mcp-client-pool.mjs';
import { BridgeRegistry } from './bridge-registry.mjs';
import { CircuitBreaker } from './circuit-breaker.mjs';
import { discoverBridges } from './discover-bridges.mjs';
import { registerNamespacedTools } from './bridge-proxy.mjs';

const DRAIN_TIMEOUT_MS = 5000;

/**
 * Bootstrap one enabled bridge into pool + registry.
 *
 * @param {object} bridgeCfg
 * @param {McpClientPool} pool
 * @param {BridgeRegistry} registry
 * @param {Function} log
 */
async function bootstrapBridge(bridgeCfg, pool, registry, log) {
  try {
    await pool.add(bridgeCfg);
    const tools = await pool.listTools(bridgeCfg.name);
    for (const tool of tools) {
      registry.register({
        bridge: bridgeCfg.name,
        originalToolName: tool.name,
        schema: tool.inputSchema ?? null,
      });
    }
    log(`Bridge '${bridgeCfg.name}' ready — ${tools.length} tool(s) registered`);
  } catch (err) {
    log(`Warning: failed to bootstrap bridge '${bridgeCfg.name}': ${err.message}`);
  }
}

/**
 * Register Brain introspection tools for bridge management.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {McpClientPool} pool
 * @param {BridgeRegistry} registry
 * @param {CircuitBreaker} breaker
 * @param {object} ctx
 * @param {Function} log
 */
function registerIntrospectionTools(server, pool, registry, breaker, ctx, log) {
  // hermit_list_bridges
  server.registerTool('hermit_list_bridges', {
    description: 'List all configured MCP bridges with their status, tool counts, and circuit breaker state.',
    inputSchema: z.object({}),
  }, async () => {
    const statuses = pool.getStatuses();
    const entries = registry.list();
    const bridges = statuses.map(s => {
      const toolCount = entries.filter(e => e.bridge === s.name).length;
      return {
        name: s.name,
        status: s.status,
        toolCount,
        lastError: s.lastError,
        breakerOpen: breaker.isOpen(s.name),
        restartAttempts: s.restartAttempts,
      };
    });
    return { content: [{ type: 'text', text: JSON.stringify(bridges, null, 2) }] };
  });

  // hermit_enable_bridge
  server.registerTool('hermit_enable_bridge', {
    description: 'Reset circuit breaker for a bridge. If the bridge is dead, also attempts to restart it.',
    inputSchema: z.object({ name: z.string() }),
  }, async ({ name }) => {
    breaker.reset(name);
    const statuses = pool.getStatuses();
    const s = statuses.find(x => x.name === name);
    if (s?.status === 'dead') {
      const cfg = ctx._bridgeConfigs?.get(name);
      if (cfg) {
        await pool.remove(name).catch(() => {});
        await pool.add(cfg).catch(err => {
          log(`Warning: restart of dead bridge '${name}' failed: ${err.message}`);
        });
      }
    }
    return { content: [{ type: 'text', text: `Bridge '${name}' circuit breaker reset.` }] };
  });

  // hermit_reload_bridges
  server.registerTool('hermit_reload_bridges', {
    description: 'Re-read bridge config from disk. Adds new bridges, removes gone ones. No Brain restart needed.',
    inputSchema: z.object({}),
  }, async () => {
    const { valid, invalid } = discoverBridges();
    const enabled = valid.filter(b => b.enabled);
    const currentNames = new Set(pool.getStatuses().map(s => s.name));
    const newNames = new Set(enabled.map(b => b.name));

    // Remove bridges no longer in config
    const toRemove = [...currentNames].filter(n => !newNames.has(n));
    for (const name of toRemove) {
      log(`Reload: draining bridge '${name}'`);
      await Promise.race([
        pool.remove(name),
        new Promise(r => setTimeout(r, DRAIN_TIMEOUT_MS)),
      ]);
      registry.removeBridge(name);
    }

    // Add new bridges
    const toAdd = enabled.filter(b => !currentNames.has(b.name));
    for (const cfg of toAdd) {
      ctx._bridgeConfigs?.set(cfg.name, cfg);
      await bootstrapBridge(cfg, pool, registry, log);
    }

    // Re-register new tools only — _registeredTools set prevents double-registration
    registerNamespacedTools(server, registry, pool, breaker, _registeredTools, ctx.traceBus ?? null);

    const summary = {
      added: toAdd.map(b => b.name),
      removed: toRemove,
      invalidCount: invalid.length,
      totalBridges: enabled.length,
    };
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  });
}

/**
 * Register the full MCP bridge subsystem on the Brain server.
 * Attaches ctx.bridgePool, ctx.bridgeRegistry, ctx.bridgeBreaker.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} ctx - Shared Brain context
 */
export async function register(server, ctx) {
  const log = ctx.log || ((m) => process.stderr.write(`[hermit:bridges] ${m}\n`));

  const pool = new McpClientPool();
  const registry = new BridgeRegistry();
  const breaker = new CircuitBreaker();
  // Tracks tool names already registered on this server instance (prevents double-register on reload)
  const _registeredTools = new Set();

  // Store bridge configs for enable_bridge restart support
  ctx._bridgeConfigs = new Map();

  // Attach to context for Phase 06+
  ctx.bridgePool = pool;
  ctx.bridgeRegistry = registry;
  ctx.bridgeBreaker = breaker;

  // Discover + bootstrap enabled bridges
  const { valid, invalid } = discoverBridges();
  if (invalid.length > 0) {
    log(`${invalid.length} invalid bridge config(s) skipped`);
  }

  const enabled = valid.filter(b => b.enabled);
  if (enabled.length === 0) {
    log('No enabled bridges configured (all disabled by default — edit ~/.hermit/mcp-bridges.json to enable)');
  }

  // Bootstrap all enabled bridges in parallel
  await Promise.allSettled(enabled.map(cfg => {
    ctx._bridgeConfigs.set(cfg.name, cfg);
    return bootstrapBridge(cfg, pool, registry, log);
  }));

  // Surface namespaced tools on the Brain server (tap point 5 wired via traceBus)
  const registered = registerNamespacedTools(server, registry, pool, breaker, _registeredTools, ctx.traceBus ?? null);
  if (registered.length > 0) {
    log(`Surfaced ${registered.length} bridged tool(s): ${registered.join(', ')}`);
  }

  // Register introspection tools
  registerIntrospectionTools(server, pool, registry, breaker, ctx, log);
  log('Bridge introspection tools registered (hermit_list_bridges, hermit_reload_bridges, hermit_enable_bridge)');
}
