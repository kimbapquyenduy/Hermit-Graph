/**
 * GitNexus runner — 4-tier execution strategy:
 *
 * 0. In-Process (fastest, ~5-100ms): direct LocalBackend import,
 *    graph DB lives in same process. Zero IPC overhead.
 * 1. MCP Bridge (~50-300ms): persistent `gitnexus mcp` subprocess,
 *    queries over JSON-RPC stdio. Fallback when in-process fails.
 * 2. Direct CLI (~400-800ms): `node <binPath> <cmd>`, shell:false.
 *    Used for `analyze` and as fallback when bridge is down.
 * 3. npx fallback (~1600ms): `npx gitnexus <cmd>`, shell:true.
 *    Last resort when binary path not found.
 */

import { spawn, execSync } from 'child_process';
import { resolve as resolvePath, join } from 'path';
import { pathToFileURL } from 'url';
import { existsSync, readdirSync } from 'fs';

const DEFAULT_TIMEOUT_MS = 30000;
const ALLOWED_CMDS = new Set(['query', 'context', 'impact', 'status', 'analyze']);
const SHELL_META = /[;&|`$(){}!<>]/;

// ── Resolve gitnexus binary path once at module load ──

let _binPath = null;

function findBinPath() {
  if (_binPath) return _binPath;

  const localBin = join(process.cwd(), 'node_modules', 'gitnexus', 'dist', 'cli', 'index.js');
  if (existsSync(localBin)) { _binPath = localBin; return _binPath; }

  try {
    const cacheDir = execSync('npm config get cache', { timeout: 5000 }).toString().trim();
    const npxDir = join(cacheDir, '_npx');
    if (existsSync(npxDir)) {
      for (const d of readdirSync(npxDir)) {
        const p = join(npxDir, d, 'node_modules', 'gitnexus', 'dist', 'cli', 'index.js');
        if (existsSync(p)) { _binPath = p; return _binPath; }
      }
    }
  } catch { /* ignore */ }

  return null;
}

findBinPath();

// ── In-Process LocalBackend — zero IPC overhead (Phase 3c) ──

let _backend = null;
let _backendFailed = false;
let _backendInitPromise = null;

function findLocalBackendPath() {
  const binPath = findBinPath();
  if (!binPath) return null;
  // binPath = .../gitnexus/dist/cli/index.js → derive local-backend.js
  const backendPath = join(binPath, '..', '..', 'mcp', 'local', 'local-backend.js');
  return existsSync(backendPath) ? backendPath : null;
}

async function ensureBackend() {
  if (_backend) return _backend;
  if (_backendFailed) return null;
  if (_backendInitPromise) return _backendInitPromise;

  _backendInitPromise = (async () => {
    try {
      const backendPath = findLocalBackendPath();
      if (!backendPath) { _backendFailed = true; return null; }

      const mod = await import(pathToFileURL(backendPath).href);
      const LocalBackend = mod.LocalBackend || mod.default;
      if (!LocalBackend) { _backendFailed = true; return null; }

      const backend = new LocalBackend();
      await backend.init();
      _backend = backend;
      return _backend;
    } catch {
      _backendFailed = true;
      return null;
    } finally {
      _backendInitPromise = null;
    }
  })();

  return _backendInitPromise;
}

async function callInProcess(cmd, args) {
  const mapping = cliArgsToMcpArgs(cmd, args);
  if (!mapping) return null;

  const backend = await ensureBackend();
  if (!backend) return null;

  const result = await backend.callTool(mapping.toolName, mapping.args);
  if (result == null) return null;
  // callTool returns raw JS objects — stringify to match bridge/CLI output format
  return typeof result === 'string' ? result : JSON.stringify(result);
}

function sanitizeArg(arg) {
  if (SHELL_META.test(arg)) throw new Error(`Invalid characters in argument: ${arg.slice(0, 40)}`);
  return arg;
}

// ── MCP Bridge — persistent gitnexus subprocess ──

/** @type {{ proc: import('child_process').ChildProcess, buffer: string, responses: Map<number, Function>, nextId: number } | null} */
let _bridge = null;
let _bridgeFailed = false; // skip bridge after repeated failures

/**
 * Parse the CLI args array back into MCP tool arguments.
 * CLI format: query <search> [-r <repo>] | context <name> [-r <repo>] | etc.
 */
function cliArgsToMcpArgs(cmd, args) {
  const repoIdx = args.indexOf('-r');
  const repo = repoIdx >= 0 ? args[repoIdx + 1] : undefined;
  const positional = args.filter((_, i) => i !== repoIdx && i !== repoIdx + 1);

  switch (cmd) {
    case 'query':
      return { toolName: 'query', args: { query: positional[0] || '', ...(repo && { repo }) } };
    case 'context':
      return { toolName: 'context', args: { name: positional[0] || '', ...(repo && { repo }) } };
    case 'impact': {
      const dirIdx = positional.indexOf('-d');
      const direction = dirIdx >= 0 ? positional[dirIdx + 1] : 'upstream';
      const target = positional.filter((_, i) => i !== dirIdx && i !== dirIdx + 1)[0] || '';
      return { toolName: 'impact', args: { target, direction, ...(repo && { repo }) } };
    }
    case 'status':
      return { toolName: 'detect_changes', args: { ...(repo && { repo }) } };
    default:
      return null; // analyze and unknown commands use CLI fallback
  }
}

function startBridge() {
  if (_bridgeFailed) return null;
  const binPath = findBinPath();
  if (!binPath) return null;

  try {
    const proc = spawn('node', [binPath, 'mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const bridge = {
      proc,
      buffer: '',
      responses: new Map(),
      nextId: 0,
      ready: false,
    };

    proc.stdout.on('data', (d) => {
      bridge.buffer += d;
      const parts = bridge.buffer.split('\n');
      bridge.buffer = parts.pop();
      for (const line of parts) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null && bridge.responses.has(msg.id)) {
            bridge.responses.get(msg.id)(msg);
            bridge.responses.delete(msg.id);
          }
        } catch { /* ignore parse errors */ }
      }
    });

    proc.stderr.on('data', () => {});
    proc.on('close', () => { if (_bridge === bridge) _bridge = null; });
    proc.on('error', () => { if (_bridge === bridge) _bridge = null; });

    return bridge;
  } catch {
    return null;
  }
}

async function ensureBridge() {
  if (_bridge?.proc?.exitCode == null && _bridge?.ready) return _bridge;
  if (_bridgeFailed) return null;

  _bridge = startBridge();
  if (!_bridge) return null;

  // Send initialize + notifications/initialized
  try {
    const initId = ++_bridge.nextId;
    const initResult = await bridgeRequest(_bridge, initId, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'hermit-bridge', version: '1.0' },
    }, 8000);

    if (!initResult) {
      _bridge.proc.kill();
      _bridge = null;
      _bridgeFailed = true;
      return null;
    }

    _bridge.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    _bridge.ready = true;
    return _bridge;
  } catch {
    try { _bridge?.proc?.kill(); } catch {}
    _bridge = null;
    _bridgeFailed = true;
    return null;
  }
}

function bridgeRequest(bridge, id, method, params, timeoutMs = 15000) {
  return new Promise((resolve) => {
    bridge.responses.set(id, resolve);
    bridge.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (bridge.responses.has(id)) {
        bridge.responses.delete(id);
        resolve(null);
      }
    }, timeoutMs);
  });
}

async function callBridge(cmd, args, timeoutMs) {
  const mapping = cliArgsToMcpArgs(cmd, args);
  if (!mapping) return null; // unsupported command

  const bridge = await ensureBridge();
  if (!bridge) return null;

  const id = ++bridge.nextId;
  const resp = await bridgeRequest(bridge, id, 'tools/call', {
    name: mapping.toolName,
    arguments: mapping.args,
  }, timeoutMs);

  if (!resp) return null;

  // Extract text content from MCP response
  const text = resp.result?.content?.[0]?.text;
  if (resp.result?.isError) throw new Error(text || 'MCP tool error');
  return text || '';
}

// ── Public API ──

/**
 * Run a GitNexus command. Strategy:
 * 0. In-process LocalBackend — fastest, zero IPC
 * 1. MCP bridge (persistent subprocess) — fallback when in-process fails
 * 2. Direct CLI — used for `analyze` and when bridge is down
 * 3. npx fallback — when binary path not found
 */
export async function runGitNexus(cmd, args = [], cwd = process.cwd(), timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!ALLOWED_CMDS.has(cmd)) throw new Error(`Unknown GitNexus command: ${cmd}`);
  if (!cwd || !cwd.trim()) throw new Error('Working directory (cwd) is required');
  const safeCwd = resolvePath(sanitizeArg(cwd));
  if (!existsSync(safeCwd)) throw new Error(`Directory not found: ${safeCwd}`);
  const safeArgs = args.map(a => sanitizeArg(a));

  // analyze always uses CLI (heavy, one-time operation)
  if (cmd === 'analyze') return runCLI(cmd, safeArgs, safeCwd, timeoutMs);

  // Tier 0: In-process LocalBackend (fastest)
  try {
    const result = await callInProcess(cmd, safeArgs);
    if (result != null) return result;
  } catch { /* fall through to bridge */ }

  // Tier 1: MCP Bridge (persistent subprocess)
  try {
    const result = await callBridge(cmd, safeArgs, timeoutMs);
    if (result != null) return result;
  } catch { /* fall through to CLI */ }

  // Tier 2/3: Direct CLI or npx fallback
  return runCLI(cmd, safeArgs, safeCwd, timeoutMs);
}

/** Direct CLI subprocess (Phase 0 strategy). */
function runCLI(cmd, safeArgs, safeCwd, timeoutMs) {
  const binPath = findBinPath();
  const spawnCmd = binPath ? 'node' : 'npx';
  const spawnArgs = binPath ? [binPath, cmd, ...safeArgs] : ['gitnexus', cmd, ...safeArgs];
  const useShell = !binPath;

  return new Promise((resolve, reject) => {
    const proc = spawn(spawnCmd, spawnArgs, {
      cwd: safeCwd,
      timeout: timeoutMs,
      shell: useShell,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else {
        const msg = stderr.trim() || `GitNexus exited with code ${code}`;
        if (msg.includes('not indexed') || msg.includes('Repository not indexed')) {
          reject(new Error('Repository not indexed. Run: npx gitnexus analyze'));
        } else {
          reject(new Error(msg));
        }
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new Error('GitNexus not installed. Run: npm install -g gitnexus'));
      else reject(err);
    });
  });
}
