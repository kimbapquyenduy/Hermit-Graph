#!/usr/bin/env node
/**
 * Hermit Graph MCP Server — unified brain for AI agents.
 * Modules: Memory (KG CRUD), CodeGraph (ast-grep), Intelligence, Cross-Module Search, Session Context, Skills Distribution.
 * Transport: stdio (JSON-RPC over stdin/stdout).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveBrainPath, getPackageRoot } from './lib/resolve-brain-path.mjs';
import { JsonlProvider } from './lib/memory/jsonl-provider.mjs';
import { SqliteProvider } from './lib/memory/sqlite-backend.mjs';
import { DualWriter } from './lib/memory/dual-writer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = getPackageRoot();

const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));

/** Stderr logger — stdout is the MCP protocol channel. */
function log(msg) {
  process.stderr.write(`[hermit] ${msg}\n`);
}

const _brainPath = resolveBrainPath();

// Phase 01b: dual-write providers
const _jsonlProvider = new JsonlProvider({ brainPath: _brainPath });
const _dbPath = _brainPath.replace(/\.jsonl$/, '.db');
const _sqliteProvider = new SqliteProvider({ dbPath: _dbPath });
const _dualWriteEnabled = process.env.HERMIT_DUAL_WRITE !== '0';
const _dualWriter = new DualWriter({
  jsonlProvider: _jsonlProvider,
  sqliteProvider: _sqliteProvider,
  enabled: _dualWriteEnabled,
});

/** Shared context passed to all modules. */
const context = {
  brainPath: _brainPath,
  packageRoot,
  log,
  // Phase 00+: JSONL provider (reads). Phase 01b+ writes route through dualWriter.
  memoryProvider: _jsonlProvider,
  // Phase 01b: dual-writer — fans writes to JSONL + SQLite under one lock.
  dualWriter: _dualWriter,
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
    './lib/session-module.mjs',
    './lib/skills-module.mjs',
    './lib/skill-search-module.mjs',
    './lib/setup-module.mjs',
    './lib/deep-scan-module.mjs',
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
  log(`CWD: ${process.cwd()}`);
  log(`CLAUDE_PROJECT_DIR: ${process.env.CLAUDE_PROJECT_DIR || '(unset)'}`);
  log(`HERMIT_PROJECT_CWD: ${process.env.HERMIT_PROJECT_CWD || '(unset)'}`);
}

main().catch((err) => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
