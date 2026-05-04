#!/usr/bin/env node
/**
 * Hermit Graph MCP Server — unified brain for AI agents.
 * Modules: Memory (KG CRUD), CodeGraph (ast-grep), Intelligence, Cross-Module Search, Session Context, Skills Distribution.
 * Transport: stdio (JSON-RPC over stdin/stdout).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveBrainPath, getPackageRoot } from './lib/resolve-brain-path.mjs';
import { JsonlProvider } from './lib/memory/jsonl-provider.mjs';
import { SqliteProvider } from './lib/memory/sqlite-backend.mjs';
import { DualWriter } from './lib/memory/dual-writer.mjs';
import { SqliteVecBackend } from './lib/memory/sqlite-vec-adapter.mjs';
import { BruteForceVectorBackend } from './lib/memory/brute-force-vector-fallback.mjs';
import { setVectorBackend } from './lib/semantic-search.mjs';

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

// Phase 03c: vector backend — try sqlite-vec first, fall back to in-memory brute-force.
// BruteForceVectorBackend is populated from JSON embedding index if present.
let _vectorBackend = null;

function _loadBruteForceFromIndex() {
  const indexPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'brain-embeddings.json');
  if (!existsSync(indexPath)) return new BruteForceVectorBackend();
  try {
    const idx = JSON.parse(readFileSync(indexPath, 'utf-8'));
    const entries = Object.entries(idx.entities || {}).map(([name, e]) => ({
      name,
      vec: new Float32Array(e.vector),
    }));
    const backend = new BruteForceVectorBackend(entries);
    log(`Brute-force fallback loaded ${entries.length} vectors from brain-embeddings.json`);
    return backend;
  } catch (err) {
    log(`Warning: Failed to load brute-force index: ${err.message}`);
    return new BruteForceVectorBackend();
  }
}

if (_sqliteProvider.vectorEnabled) {
  try {
    _vectorBackend = new SqliteVecBackend({ db: _sqliteProvider.getDb() });
    log(`Vector backend ready (sqlite-vec, dim=384, mode=${process.env.HERMIT_EMBED_MODE || 'eager'})`);
  } catch (err) {
    log(`WARNING: sqlite-vec backend failed to init: ${err.message}`);
    log(`WARNING: Falling back to in-memory brute-force vector search — performance degraded for large vaults`);
    _vectorBackend = _loadBruteForceFromIndex();
  }
} else {
  log('WARNING: sqlite-vec not loaded — falling back to in-memory brute-force vector search');
  _vectorBackend = _loadBruteForceFromIndex();
}

// Phase 03c: inject backend into semantic-search for kNN path
setVectorBackend(_vectorBackend);

const _dualWriter = new DualWriter({
  jsonlProvider: _jsonlProvider,
  sqliteProvider: _sqliteProvider,
  enabled: _dualWriteEnabled,
  vectorBackend: _vectorBackend,
});

// Phase 01c: opt-in read primary via HERMIT_PRIMARY_READ=sqlite (default: jsonl)
const _readPrimary = process.env.HERMIT_PRIMARY_READ === 'sqlite' ? 'sqlite' : 'jsonl';
const _readProvider = _readPrimary === 'sqlite' ? _sqliteProvider : _jsonlProvider;
const _fallbackProvider = _readPrimary === 'sqlite' ? _jsonlProvider : null;

/** Shared context passed to all modules. */
const context = {
  brainPath: _brainPath,
  packageRoot,
  log,
  // Phase 01c: memoryProvider is the active read primary (jsonl default, sqlite opt-in).
  memoryProvider: _readProvider,
  // Phase 01c: fallbackProvider used when memoryProvider read throws (sqlite mode only).
  fallbackProvider: _fallbackProvider,
  // Phase 01b: dual-writer — fans writes to JSONL + SQLite under one lock.
  dualWriter: _dualWriter,
  // Phase 03c: vector backend (sqlite-vec primary, brute-force fallback — never null after 03c).
  vectorBackend: _vectorBackend,
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

/**
 * Boot-time staleness check — warns if brain.jsonl is newer than brain.db.
 * Non-blocking: logs to stderr only, never throws.
 */
function checkStaleness() {
  try {
    const jsonlExists = existsSync(_brainPath);
    const dbExists    = existsSync(_dbPath);
    if (jsonlExists && dbExists) {
      const jsonlMtime = statSync(_brainPath).mtimeMs;
      const dbMtime    = statSync(_dbPath).mtimeMs;
      const diffMs     = jsonlMtime - dbMtime;
      if (diffMs > 5 * 60 * 1000) {
        log(`WARNING: brain.jsonl is newer than brain.db by ${Math.round(diffMs / 60000)}min — run 'hermit-migrate' to sync`);
      }
    } else if (jsonlExists && !dbExists && _readPrimary === 'sqlite') {
      log(`WARNING: HERMIT_PRIMARY_READ=sqlite but brain.db does not exist — run 'hermit-migrate' to create it`);
    }
  } catch (_e) {
    // stat errors are non-fatal
  }
}

async function main() {
  checkStaleness();
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
