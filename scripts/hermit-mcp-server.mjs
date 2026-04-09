#!/usr/bin/env node
/**
 * Hermit Graph MCP Server — unified brain for AI agents.
 * Modules: Memory (KG CRUD), CodeGraph (GitNexus), Intelligence, Cross-Module Search.
 * Transport: stdio (JSON-RPC over stdin/stdout).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveBrainPath, getPackageRoot } from './lib/resolve-brain-path.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = getPackageRoot();

const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));

/** Stderr logger — stdout is the MCP protocol channel. */
function log(msg) {
  process.stderr.write(`[hermit] ${msg}\n`);
}

/** Shared context passed to all modules. */
const context = {
  brainPath: resolveBrainPath(),
  packageRoot,
  log,
  // Populated by memory module after registration
  getEntities: null,
  getRelations: null,
};

const server = new McpServer({
  name: 'hermit-graph',
  version: pkg.version,
});

/** Load and register all modules. Non-fatal per module. */
async function loadModules() {
  const modules = [
    './lib/memory-module.mjs',
    './lib/codegraph-module.mjs',
    './lib/intelligence-module.mjs',
    './lib/unified-search.mjs',
  ];

  for (const mod of modules) {
    try {
      const { register } = await import(mod);
      register(server, context);
      log(`Module loaded: ${mod}`);
    } catch (err) {
      log(`Warning: Failed to load ${mod}: ${err.message}`);
    }
  }
}

async function main() {
  await loadModules();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log(`Hermit Graph MCP Server v${pkg.version} running (stdio)`);
  log(`Brain: ${context.brainPath}`);
}

main().catch((err) => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
