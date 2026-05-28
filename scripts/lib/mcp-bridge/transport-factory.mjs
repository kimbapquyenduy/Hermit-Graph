/**
 * transport-factory.mjs — Creates MCP client transports from bridge config.
 *
 * Supports:
 *   - stdio: StdioClientTransport from @modelcontextprotocol/sdk/client/stdio.js
 *   - http:  StreamableHTTPClientTransport from @modelcontextprotocol/sdk/client/streamableHttp.js
 *
 * Import paths verified against SDK v1.29.0 dist/esm layout.
 */

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * @typedef {Object} BridgeConfig
 * @property {string} name - Bridge identifier
 * @property {'stdio'|'http'} transport - Transport type
 * @property {string} [command] - Executable for stdio
 * @property {string[]} [args] - Arguments for stdio
 * @property {Record<string,string>} [env] - Extra env vars for stdio
 * @property {string} [url] - Base URL for http transport
 * @property {Record<string,string>} [headers] - HTTP headers
 */

/**
 * Create and return an MCP client transport for the given bridge config.
 * Does NOT connect — caller must call transport methods as needed by Client.
 *
 * @param {BridgeConfig} config
 * @returns {StdioClientTransport|StreamableHTTPClientTransport}
 */
export function createTransport(config) {
  if (config.transport === 'http') {
    if (!config.url) throw new Error(`bridge '${config.name}': http transport requires url`);
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });
  }

  // Default: stdio
  if (!config.command) throw new Error(`bridge '${config.name}': stdio transport requires command`);

  // Explicit env allowlist: inherit safe vars + user-provided extras only
  const safeEnv = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || process.env.USERPROFILE || '',
    USERPROFILE: process.env.USERPROFILE || '',
    TMPDIR: process.env.TMPDIR || process.env.TEMP || '',
    TEMP: process.env.TEMP || '',
    TMP: process.env.TMP || '',
    ...(config.env || {}),
  };

  return new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: safeEnv,
  });
}
