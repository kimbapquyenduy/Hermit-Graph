/**
 * mock-mcp-server.mjs — Minimal in-process MCP server for tests.
 *
 * Spawned as a child process via Node's --input-type flag or as a standalone
 * script. Speaks MCP stdio protocol with one trivial tool: "echo".
 *
 * Usage (from tests):
 *   import { MOCK_SERVER_SCRIPT } from './helpers/mock-mcp-server.mjs';
 *   // pass MOCK_SERVER_SCRIPT as `command` to McpClientPool.add()
 *
 * The file doubles as the script itself — when run as main it starts the server.
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to this file — used as `command: 'node'`, `args: [MOCK_SERVER_SCRIPT]` */
export const MOCK_SERVER_SCRIPT = __filename;

/** Default tool definitions exposed by the mock server */
export const MOCK_TOOLS = [
  {
    name: 'echo',
    description: 'Returns the input message unchanged',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },
  {
    name: 'add',
    description: 'Adds two numbers',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number' },
        b: { type: 'number' },
      },
      required: ['a', 'b'],
    },
  },
];

// ── Server mode (when run as main) ──────────────────────────────────────────

if (process.argv[1] === __filename) {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { z } = await import('zod');

  const server = new McpServer({ name: 'mock-mcp', version: '0.0.1' });

  server.registerTool('echo', {
    description: 'Returns the input message unchanged',
    inputSchema: { message: z.string() },
  }, async ({ message }) => ({
    content: [{ type: 'text', text: message }],
  }));

  server.registerTool('add', {
    description: 'Adds two numbers',
    inputSchema: { a: z.number(), b: z.number() },
  }, async ({ a, b }) => ({
    content: [{ type: 'text', text: String(a + b) }],
  }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep alive — test harness kills the process when done
}
