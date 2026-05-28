/**
 * bridge-registry.mjs — Namespace registry for bridged MCP tools.
 *
 * Maps namespaced tool names → { bridge, originalToolName, schema }.
 * Namespacing: mcp_<bridgeName>_<sanitizedToolName>
 * Sanitize: replace non-alphanumeric (except _) with _
 *
 * O(1) lookup via Map.
 */

/**
 * @typedef {Object} RegistryEntry
 * @property {string} bridge          - Bridge name
 * @property {string} originalToolName - Original tool name on the foreign server
 * @property {object|null} schema     - Tool input schema (JSON Schema object)
 * @property {string} namespacedName  - Computed namespaced name
 */

/**
 * Sanitize a tool name for use in a namespaced identifier.
 * Replaces any character that is not alphanumeric or _ with _.
 *
 * @param {string} name
 * @returns {string}
 */
export function sanitizeToolName(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Compute the namespaced tool name.
 *
 * @param {string} bridge
 * @param {string} toolName
 * @returns {string}
 */
export function namespaceTool(bridge, toolName) {
  return `mcp_${bridge}_${sanitizeToolName(toolName)}`;
}

export class BridgeRegistry {
  constructor() {
    /** @type {Map<string, RegistryEntry>} */
    this._map = new Map();
  }

  /**
   * Register a tool from a bridge.
   * If namespacedName already registered for same bridge+tool, it is overwritten (idempotent reload).
   *
   * @param {{ bridge: string, originalToolName: string, schema?: object|null }} opts
   * @returns {string} The namespaced tool name
   */
  register({ bridge, originalToolName, schema = null }) {
    const namespacedName = namespaceTool(bridge, originalToolName);
    this._map.set(namespacedName, { bridge, originalToolName, schema, namespacedName });
    return namespacedName;
  }

  /**
   * Resolve a namespaced name to its registry entry.
   *
   * @param {string} namespacedName
   * @returns {RegistryEntry|null}
   */
  resolve(namespacedName) {
    return this._map.get(namespacedName) ?? null;
  }

  /**
   * List all registered entries.
   *
   * @returns {RegistryEntry[]}
   */
  list() {
    return [...this._map.values()];
  }

  /**
   * Remove all entries for a specific bridge (used during reload).
   *
   * @param {string} bridge
   * @returns {string[]} Removed namespaced names
   */
  removeBridge(bridge) {
    const removed = [];
    for (const [key, entry] of this._map) {
      if (entry.bridge === bridge) {
        this._map.delete(key);
        removed.push(key);
      }
    }
    return removed;
  }

  /**
   * Count of registered entries.
   * @returns {number}
   */
  get size() {
    return this._map.size;
  }
}
