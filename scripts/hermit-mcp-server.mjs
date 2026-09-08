#!/usr/bin/env node
/**
 * Hermit Graph MCP Server — unified brain for AI agents.
 * Modules: Memory (KG CRUD), CodeGraph (ast-grep), Intelligence, Cross-Module Search, Session Context, Skills Distribution.
 * Transport: stdio (JSON-RPC over stdin/stdout).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { resolveBrainPath, getPackageRoot } from './lib/resolve-brain-path.mjs';
import { TraceEmitter } from './lib/skill-evolution/trace-emitter.mjs';
import { JsonlProvider } from './lib/memory/jsonl-provider.mjs';
import { SqliteProvider } from './lib/memory/sqlite-backend.mjs';
import { SqliteWriter } from './lib/memory/sqlite-writer.mjs';
import { DualWriter } from './lib/memory/dual-writer.mjs';
import { SqliteVecBackend } from './lib/memory/sqlite-vec-adapter.mjs';
import { BruteForceVectorBackend } from './lib/memory/brute-force-vector-fallback.mjs';
import { setVectorBackend, setHybridContext } from './lib/semantic-search.mjs';
import { warmup as warmupEmbeddings } from './lib/embedding-service.mjs';
import { ensureIndexParity } from './lib/memory/index-parity-guard.mjs';
import { detectVaultState, autoMigrate } from './lib/memory/v6-detect-and-migrate.mjs';
import { makeProfileProxy, getProfile } from './lib/token-diet/tool-profile.mjs';
import { SERVER_INSTRUCTIONS } from './lib/token-diet/server-instructions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = getPackageRoot();

const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));

/** Stderr logger — stdout is the MCP protocol channel. */
function log(msg) {
  process.stderr.write(`[hermit] ${msg}\n`);
}

const _brainPath = resolveBrainPath();
const _dbPath = _brainPath.replace(/\.jsonl$/, '.db');

// Phase 08: v6 vault auto-detection and migration (runs before providers init)
// Silently skip in test/CI environments where brain path may be synthetic.
const _vaultState = detectVaultState({ brainPath: _brainPath, dbPath: _dbPath });
if (_vaultState === 'v6-needs-migrate') {
  log(`Boot: v6 vault detected at ${_brainPath} — starting auto-migration...`);
  const result = await autoMigrate({ brainPath: _brainPath, dbPath: _dbPath, log });
  if (result.migrated) {
    log(`Boot: v6 → v7 migration complete (${result.entityCount} entities). Backup: ${result.backupPath}`);
  } else {
    log('Boot: v6 migration skipped or failed — check logs above. Vault unchanged.');
  }
}

// brain.jsonl is the source of truth; brain.db is a derived index (see
// lib/memory/index-parity-guard.mjs for the decision and its rationale).
// Detect drift and rebuild the index from truth BEFORE any provider opens a
// handle, so a missed mirror write can never silently serve stale reads again.
const _parity = ensureIndexParity({ brainPath: _brainPath, dbPath: _dbPath, log });
if (_parity.healed) log('Index rebuilt from brain.jsonl (source of truth)');

// Phase 08: providers — SQLite serves indexed reads (FTS + vector)
const _jsonlProvider = new JsonlProvider({ brainPath: _brainPath });
const _sqliteProvider = new SqliteProvider({ dbPath: _dbPath });

// Phase 08: escape hatch — HERMIT_LEGACY_DUAL_WRITE=1 re-enables JSONL fan-out.
// For users who want dual-write temporarily during transition.
// Marked for removal in v8.0.
const _legacyDualWrite = process.env.HERMIT_LEGACY_DUAL_WRITE === '1';

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

// Phase 08: write path — SqliteWriter by default; DualWriter if escape hatch set.
// HERMIT_LEGACY_DUAL_WRITE=1 → also write JSONL (marked for removal in v8.0).
const _dualWriter = _legacyDualWrite
  ? new DualWriter({
      jsonlProvider: _jsonlProvider,
      sqliteProvider: _sqliteProvider,
      enabled: true,
      vectorBackend: _vectorBackend,
    })
  : new SqliteWriter({
      sqliteProvider: _sqliteProvider,
      vectorBackend: _vectorBackend,
    });
if (_legacyDualWrite) log('WARNING: HERMIT_LEGACY_DUAL_WRITE=1 — dual-write mode active (v8.0 removal target)');

// Phase 08: read primary is SQLite by default (was jsonl in Phase 01c).
// JSONL fallback kept only for explicit HERMIT_PRIMARY_READ=jsonl override.
const _readPrimary = process.env.HERMIT_PRIMARY_READ === 'jsonl' ? 'jsonl' : 'sqlite';
const _readProvider = _readPrimary === 'sqlite' ? _sqliteProvider : _jsonlProvider;
const _fallbackProvider = _readPrimary === 'sqlite' ? null : null;

// Phase 07: trace bus — opt-in via HERMIT_TRACE_BUS=1
// Default OFF: ctx.traceBus = null → all tap-point guards are no-ops (zero overhead).
const _traceBusEnabled = process.env.HERMIT_TRACE_BUS === '1';
const _traceSinkPath = process.env.HERMIT_TRACE_SINK || null;
const _traceBus = _traceBusEnabled
  ? new TraceEmitter({ ringSize: 1000, sinkPath: _traceSinkPath })
  : null;
if (_traceBus) {
  log(`Trace bus enabled (ring=1000${_traceSinkPath ? `, sink=${_traceSinkPath}` : ', no sink'})`);
}

// Phase 04b: hybrid retrieval flag
// HERMIT_RETRIEVAL=hybrid|bm25|vector
// Default: bm25 — quality gate missed (+10% NDCG@10 not achieved in Phase 04b).
//   Opt-in: set HERMIT_RETRIEVAL=hybrid to enable RRF fusion.
//   Re-evaluate after backfilling sqlite-vec embeddings (currently 0 stored).
// HERMIT_RETRIEVAL_LOG=1  enables A/B logging per query
const _retrievalMode = process.env.HERMIT_RETRIEVAL || 'bm25';
const _retrievalLog  = process.env.HERMIT_RETRIEVAL_LOG === '1';
log(`Retrieval mode: ${_retrievalMode}${_retrievalLog ? ' (logging enabled)' : ''}`);
setHybridContext({ memoryProvider: _readProvider, vectorBackend: _vectorBackend, mode: _retrievalMode, log: _retrievalLog ? log : null });

// Pre-load the embedding model when this session will actually use vectors, so
// the ~23MB model load lands at startup instead of inside the first user-facing
// tool call. Fire-and-forget: a failure is cached and degrades to keyword
// search. Skipped for the default bm25 mode, which never embeds.
if (_retrievalMode !== 'bm25') {
  warmupEmbeddings()
    .then((ready) => log(`Embedding model ${ready ? 'warm' : 'unavailable (keyword fallback)'}`))
    .catch((err) => log(`Embedding warmup failed: ${err.message}`));
}

/** Shared context passed to all modules. */
const context = {
  brainPath: _brainPath,
  packageRoot,
  log,
  // Phase 08: memoryProvider is SQLite by default (was jsonl in Phase 01c).
  memoryProvider: _readProvider,
  // Phase 08: fallbackProvider null — SQLite is authoritative. Kept for interface compat.
  fallbackProvider: _fallbackProvider,
  // Phase 08: sqliteWriter replaces dualWriter. Also aliased as dualWriter for module compat.
  sqliteWriter: _dualWriter,
  dualWriter: _dualWriter,
  // Phase 03c: vector backend (sqlite-vec primary, brute-force fallback — never null after 03c).
  vectorBackend: _vectorBackend,
  // Phase 07: trace bus — null when HERMIT_TRACE_BUS unset (zero overhead path).
  traceBus: _traceBus,
  // Populated by memory module after registration
  getEntities: null,
  getRelations: null,
};

const server = new McpServer({
  name: 'hermit-graph',
  version: pkg.version,
}, {
  instructions: SERVER_INSTRUCTIONS,
});

// Token-diet: wrap with profile proxy so non-core tools are skipped silently
// under HERMIT_TOOL_PROFILE=core (default). Set HERMIT_TOOL_PROFILE=full to
// register all 34 tools (back-compat / power users).
const profile = getProfile();
const registrationTarget = makeProfileProxy(server, log);
log(`Tool profile: ${profile}${profile === 'core' ? ' (14 core tools; set HERMIT_TOOL_PROFILE=full for all 34)' : ''}`);

/**
 * Register hermit_tap_traces — introspection tool for the trace ring buffer.
 * Returns [] if trace bus is disabled. N is capped at 1000.
 */
function registerTapTracesTool() {
  registrationTarget.tool('hermit_tap_traces', 'Inspect recent execution trace events from the in-memory ring buffer (last N events). Only populated when HERMIT_TRACE_BUS=1. Returns [] when trace bus is disabled. Tap points: tool:call, tool:result, search:query, search:fusion, bridge:forward. Use for observability and debugging.', {
    n: z.number().int().min(1).max(1000).optional().default(50).describe('Number of recent events to return (default 50, max 1000)'),
  }, { readOnlyHint: true }, async ({ n = 50 }) => {
    if (!_traceBus) {
      return { content: [{ type: 'text', text: '[]' }] };
    }
    const count = Math.min(Math.max(1, Math.floor(n)), 1000);
    const events = _traceBus.getRecent(count);
    return { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] };
  });
}

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
    './lib/mcp-bridge/index.mjs',
  ];

  for (const mod of modules) {
    try {
      const { register } = await import(mod);
      register(registrationTarget, context);
      log(`Module loaded: ${mod}`);
    } catch (err) {
      log(`Warning: Failed to load ${mod}: ${err.message}`);
    }
  }
}

/**
 * Boot-time staleness check — v8 SQLite-only: warns if brain.db is missing.
 * Non-blocking: logs to stderr only, never throws.
 */
function checkStaleness() {
  try {
    const dbExists = existsSync(_dbPath);
    if (!dbExists) {
      // Fresh install or v6 vault already handled by detectVaultState above
      log('INFO: brain.db not found — will be created on first write');
    }
  } catch (_e) {
    // stat errors are non-fatal
  }
}

async function main() {
  checkStaleness();
  await loadModules();
  registerTapTracesTool();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log(`Hermit Graph MCP Server v${pkg.version} running (stdio)`);
  log(`Brain: ${context.brainPath}`);
  log(`CWD: ${process.cwd()}`);
  log(`CLAUDE_PROJECT_DIR: ${process.env.CLAUDE_PROJECT_DIR || '(unset)'}`);
  log(`HERMIT_PROJECT_CWD: ${process.env.HERMIT_PROJECT_CWD || '(unset)'}`);

  // Graceful shutdown: flush trace sink + close bridge pool before exit.
  const shutdown = async () => {
    if (context.traceBus) {
      await context.traceBus.close().catch(() => {});
    }
    if (context.bridgePool) {
      log('Shutting down bridge pool...');
      await context.bridgePool.shutdownAll().catch(() => {});
    }
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
