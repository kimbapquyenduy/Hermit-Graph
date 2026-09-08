/**
 * Tool surface diet — registers only CORE tools by default, slashing the MCP
 * tool-catalog size in the agent's system prompt.
 *
 * Profile selection via env var HERMIT_TOOL_PROFILE:
 *   - 'core' (default)  — 14 tools covering 95% of agent flows (read + minimal write)
 *   - 'full'            — all 34 tools (back-compat / power users)
 *
 * Skipped tools still exist in the codebase — they're just not advertised
 * to the agent. Set HERMIT_TOOL_PROFILE=full to opt back in.
 */

/**
 * The agent-facing core. Picked to cover:
 *   - Code intel: query, context, impact, detect_changes, index
 *   - Brain recall: semantic_search, search_nodes, open_nodes
 *   - Brain write: create_entities, add_observations, create_relations
 *     (without these, "core" profile can recall but never grow the brain —
 *      session_start instructions still advertise the save flow)
 *   - Cross-domain: unified_search
 *   - Bootstrap: session_start
 *   - Health: health
 *
 * Anything not here requires HERMIT_TOOL_PROFILE=full.
 */
export const CORE_TOOLS = new Set([
  'hermit_query',
  'hermit_context',
  'hermit_impact',
  'hermit_detect_changes',
  'hermit_index',
  'hermit_semantic_search',
  'hermit_search_nodes',
  'hermit_open_nodes',
  'hermit_create_entities',
  'hermit_add_observations',
  'hermit_create_relations',
  'hermit_unified_search',
  'hermit_session_start',
  'hermit_health',
]);

/**
 * Get the active profile from env. Defaults to 'core'.
 */
export function getProfile() {
  const raw = (process.env.HERMIT_TOOL_PROFILE || 'core').toLowerCase();
  if (raw === 'full' || raw === 'all') return 'full';
  return 'core';
}

/**
 * Whether a tool name is registered under the active profile.
 * @param {string} name
 */
export function isToolEnabled(name) {
  return getProfile() === 'full' || CORE_TOOLS.has(name);
}

/**
 * Build a profile-filtering proxy around an McpServer instance.
 * Modules call proxy.tool(name, ...) — proxy silently skips when name
 * not in active profile.
 *
 * @param {object} server — McpServer instance
 * @param {Function} log
 */
export function makeProfileProxy(server, log) {
  const profile = getProfile();
  if (profile === 'full') return server; // pass-through
  return new Proxy(server, {
    get(target, prop) {
      // Intercept both `tool()` and `registerTool()` — mcp-bridge uses
      // the latter; other modules use the former.
      if (prop === 'tool' || prop === 'registerTool') {
        return function (name, ...rest) {
          if (!CORE_TOOLS.has(name)) {
            log?.(`tool-profile: skipping ${name} (profile=core; set HERMIT_TOOL_PROFILE=full to enable)`);
            return undefined;
          }
          return target[prop].call(target, name, ...rest);
        };
      }
      return target[prop];
    },
  });
}
