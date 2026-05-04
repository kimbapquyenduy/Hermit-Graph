/**
 * bridge-proxy.mjs — Registers namespaced tools on Brain MCP server, forwarding
 * calls to the appropriate bridge via the pool, guarded by the circuit breaker.
 *
 * For each registry entry:
 *   server.registerTool(namespacedName, schema, handler)
 *   handler: check breaker → pool.callTool → record outcome
 */

import { z } from 'zod';

/**
 * Convert a JSON Schema object property map to a zod object schema.
 * Produces a passthrough object so unknown keys from foreign tools don't fail.
 * Falls back to z.record(z.unknown()) if schema is missing/invalid.
 *
 * @param {object|null|undefined} inputSchema
 * @returns {import('zod').ZodTypeAny}
 */
function jsonSchemaToZod(inputSchema) {
  if (!inputSchema || inputSchema.type !== 'object' || !inputSchema.properties) {
    return z.record(z.string(), z.unknown()).optional().default({});
  }
  const shape = {};
  const required = new Set(inputSchema.required || []);
  for (const [key, prop] of Object.entries(inputSchema.properties)) {
    let fieldSchema;
    switch (prop.type) {
      case 'string':  fieldSchema = z.string(); break;
      case 'number':  fieldSchema = z.number(); break;
      case 'boolean': fieldSchema = z.boolean(); break;
      case 'integer': fieldSchema = z.number().int(); break;
      case 'array':   fieldSchema = z.array(z.unknown()); break;
      default:        fieldSchema = z.unknown();
    }
    shape[key] = required.has(key) ? fieldSchema : fieldSchema.optional();
  }
  return z.object(shape).passthrough();
}

/**
 * Register all entries in registry as tools on the Brain MCP server.
 * Each handler checks the circuit breaker, forwards to pool, records outcome.
 * Already-registered tool names are skipped (idempotent — safe to call on reload).
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('./bridge-registry.mjs').BridgeRegistry} registry
 * @param {import('./mcp-client-pool.mjs').McpClientPool} pool
 * @param {import('./circuit-breaker.mjs').CircuitBreaker} breaker
 * @param {Set<string>} [alreadyRegistered] - Tracks names registered across calls
 * @param {object|null} [traceBus] - Optional trace bus for tap point 5 (bridge:forward)
 * @returns {string[]} Newly registered namespaced tool names
 */
export function registerNamespacedTools(server, registry, pool, breaker, alreadyRegistered = new Set(), traceBus = null) {
  const registered = [];
  for (const entry of registry.list()) {
    const { namespacedName, bridge, originalToolName, schema } = entry;

    // Skip if already registered on this server instance
    if (alreadyRegistered.has(namespacedName)) continue;

    const inputSchema = jsonSchemaToZod(schema);

    server.registerTool(namespacedName, {
      description: schema?.description
        || `Bridged tool from '${bridge}': ${originalToolName}`,
      inputSchema,
    }, async (args) => {
      if (breaker.isOpen(bridge)) {
        throw new Error(
          `bridge '${bridge}' is in circuit-open state (3 consecutive failures); ` +
          `call hermit_enable_bridge to recover`
        );
      }
      // Tap point 5: bridge:forward
      const t0 = Date.now();
      try {
        const result = await pool.callTool(bridge, originalToolName, args);
        breaker.record(bridge, true);
        if (traceBus) {
          traceBus.emit('bridge:forward', { bridge, tool: originalToolName, durationMs: Date.now() - t0, success: true });
        }
        return result;
      } catch (err) {
        breaker.record(bridge, false);
        if (traceBus) {
          traceBus.emit('bridge:forward', { bridge, tool: originalToolName, durationMs: Date.now() - t0, success: false });
        }
        throw err;
      }
    });

    alreadyRegistered.add(namespacedName);
    registered.push(namespacedName);
  }
  return registered;
}
