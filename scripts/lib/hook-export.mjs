/**
 * hook-export.mjs — Export engine for hook distribution across AI agents.
 *
 * Discovers hooks from catalog/hooks/, maps agent from filename convention,
 * copies hook files + lib/ dependencies to target locations.
 *
 * Separated from skill-export.mjs because hooks have distinct concerns:
 * file copying (not content transforms) + lib/ co-location requirement.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { AGENTS } from './skill-adapters.mjs';
import { getPackageRoot, resolveBrainPath } from './resolve-brain-path.mjs';

// ── Hook name parsing ──────────────────────────────────────────────────

/** Known agent suffixes for hook filename parsing */
const HOOK_AGENT_SUFFIXES = Object.keys(AGENTS).filter(k => k !== 'claude');

/**
 * Parse hook filename to extract purpose and target agent.
 * Convention: {purpose}-{agent}.cjs — no suffix means Claude (default).
 * @param {string} filename - e.g. 'kg-auto-recall-cursor.cjs'
 * @returns {{ purpose: string, agent: string }}
 */
export function parseHookName(filename) {
  const base = filename.replace(/\.cjs$/, '');
  for (const agent of HOOK_AGENT_SUFFIXES) {
    if (base.endsWith(`-${agent}`)) {
      return { purpose: base.slice(0, -(agent.length + 1)), agent };
    }
  }
  return { purpose: base, agent: 'claude' };
}

// ── Hook discovery ─────────────────────────────────────────────────────

/**
 * Discover all hooks from catalog/hooks/.
 * @param {string} [catalogRoot] - Override catalog root (for testing)
 * @returns {Array<{ filename, purpose, agent, hasLib }>}
 */
export function discoverHooks(catalogRoot) {
  const hooksDir = join(catalogRoot || getPackageRoot(), 'catalog', 'hooks');
  if (!existsSync(hooksDir)) return [];

  const libDir = join(hooksDir, 'lib');
  const hasLib = existsSync(libDir) && statSync(libDir).isDirectory();

  return readdirSync(hooksDir)
    .filter(f => f.endsWith('.cjs') && statSync(join(hooksDir, f)).isFile())
    .map(filename => {
      const { purpose, agent } = parseHookName(filename);
      return { filename, purpose, agent, hasLib };
    });
}

// ── Lib directory copying ──────────────────────────────────────────────

/**
 * Copy lib/ directory contents to target location.
 * Only copies .cjs files (hooks' shared dependencies).
 * @param {string} srcLibDir - Source lib/ directory
 * @param {string} dstLibDir - Target lib/ directory
 */
export function copyLibDir(srcLibDir, dstLibDir) {
  if (!existsSync(srcLibDir)) return;
  mkdirSync(dstLibDir, { recursive: true });

  for (const f of readdirSync(srcLibDir)) {
    const srcFile = join(srcLibDir, f);
    if (statSync(srcFile).isFile() && f.endsWith('.cjs')) {
      copyFileSync(srcFile, join(dstLibDir, f));
    }
  }
}

// ── MCP config generation ─────────────────────────────────────────────

/**
 * Resolve absolute path to node executable.
 * Needed for Antigravity IDE which doesn't inherit shell PATH.
 * @returns {string} Absolute path with forward slashes
 */
function resolveNodePath() {
  try {
    const cmd = process.platform === 'win32' ? 'where node' : 'which node';
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0].replace(/\\/g, '/');
  } catch {
    return 'node'; // fallback — works in terminals but may fail in GUI IDEs
  }
}

/**
 * Build hermit-graph MCP server config object.
 * @param {{ useAbsoluteNodePath?: boolean }} opts
 * @returns {{ command: string, args: string[], env: object }}
 */
function buildMcpServerConfig(opts = {}) {
  const serverScript = join(getPackageRoot(), 'scripts', 'hermit-mcp-server.mjs').replace(/\\/g, '/');
  const brainPath = resolveBrainPath();
  const command = opts.useAbsoluteNodePath ? resolveNodePath() : 'node';

  return {
    command,
    args: [serverScript],
    env: {
      MEMORY_FILE_PATH: brainPath,
      HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
    },
  };
}

/**
 * Write Antigravity IDE MCP config (~/.gemini/antigravity/mcp_config.json).
 * Uses absolute node path since Antigravity GUI doesn't inherit shell PATH.
 * @returns {{ path: string, action: string }}
 */
function writeAntigravityMcpConfig(agentConfig) {
  const configPath = agentConfig.mcp.antigravityConfig();
  const existed = existsSync(configPath);
  const config = { mcpServers: { 'hermit-graph': buildMcpServerConfig({ useAbsoluteNodePath: true }) } };

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return { path: configPath.replace(/\\/g, '/'), action: existed ? 'updated' : 'created' };
}

/**
 * Merge hermit-graph MCP config into ~/.gemini/settings.json.
 * Preserves existing hooks, security, and other settings.
 * @returns {{ path: string, action: string }}
 */
function mergeGeminiSettingsMcp(agentConfig) {
  const settingsPath = agentConfig.mcp.settingsPath();
  let settings = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, 'utf-8')); } catch { /* start fresh */ }
  }

  if (!settings.mcpServers) settings.mcpServers = {};
  const serverConfig = buildMcpServerConfig({ useAbsoluteNodePath: false });
  settings.mcpServers['hermit-graph'] = { ...serverConfig, timeout: 30000, trust: true };

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return { path: settingsPath.replace(/\\/g, '/'), action: 'merged' };
}

/**
 * Write MCP config for Cursor agent (~/.cursor/mcp.json).
 * Called automatically during global hook export for cursor.
 * @returns {Array<{ path, action, agent, name }>}
 */
export function writeCursorMcpConfig() {
  const agentConfig = AGENTS.cursor;
  if (!agentConfig?.mcp) return [];

  const results = [];
  try {
    const configPath = agentConfig.mcp.globalPath();
    let config = {};
    if (existsSync(configPath)) {
      try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { /* start fresh */ }
    }

    if (!config.mcpServers) config.mcpServers = {};
    // Remove legacy 'memory' key
    delete config.mcpServers.memory;
    config.mcpServers['hermit-graph'] = buildMcpServerConfig({ useAbsoluteNodePath: false });

    const existed = existsSync(configPath);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    results.push({
      path: configPath.replace(/\\/g, '/'),
      action: existed ? 'updated' : 'created',
      agent: 'cursor',
      name: 'mcp.json',
    });
  } catch (err) {
    results.push({ path: '', action: 'error', agent: 'cursor', name: 'mcp.json', reason: err.message });
  }
  return results;
}

/**
 * Write MCP configs for Gemini agent (Antigravity IDE + Gemini CLI).
 * Called automatically during global hook export for gemini.
 * @returns {Array<{ path, action, agent, name }>}
 */
export function writeGeminiMcpConfigs() {
  const agentConfig = AGENTS.gemini;
  if (!agentConfig?.mcp) return [];

  const results = [];
  try {
    const ag = writeAntigravityMcpConfig(agentConfig);
    results.push({ ...ag, agent: 'gemini', name: 'antigravity/mcp_config.json' });
  } catch (err) {
    results.push({ path: '', action: 'error', agent: 'gemini', name: 'antigravity/mcp_config.json', reason: err.message });
  }

  try {
    const gs = mergeGeminiSettingsMcp(agentConfig);
    results.push({ ...gs, agent: 'gemini', name: 'settings.json (mcpServers)' });
  } catch (err) {
    results.push({ path: '', action: 'error', agent: 'gemini', name: 'settings.json', reason: err.message });
  }

  return results;
}

// ── Hook export ────────────────────────────────────────────────────────

/**
 * Export a single hook to target location.
 * @param {string} hookFilename - Hook filename (e.g. 'kg-auto-recall-cursor.cjs')
 * @param {string} agentName - Target agent key
 * @param {{ project?: string, global?: boolean }} opts
 * @param {string} [catalogRoot] - Override catalog root (for testing)
 */
export function exportHook(hookFilename, agentName, opts = {}, catalogRoot) {
  const root = catalogRoot || getPackageRoot();
  const agentConfig = AGENTS[agentName];
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);
  if (!agentConfig.hooks) throw new Error(`Agent ${agentName} has no hook config`);

  const hookCfg = agentConfig.hooks;
  const hooksDir = join(root, 'catalog', 'hooks');
  const srcPath = join(hooksDir, hookFilename);
  if (!existsSync(srcPath)) throw new Error(`Hook not found: ${hookFilename}`);

  // Resolve target path
  const useGlobal = opts.global || !opts.project;
  const targetPath = useGlobal
    ? hookCfg.globalPath(hookFilename)
    : hookCfg.path(hookFilename, opts.project);

  // Copy hook file — back up the existing file before overwriting
  const existed = existsSync(targetPath);
  mkdirSync(dirname(targetPath), { recursive: true });
  if (existed) {
    const backupDir = join(dirname(targetPath), '.hermit-backups');
    mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    copyFileSync(targetPath, join(backupDir, `${hookFilename}.${ts}.bak`));
  }
  copyFileSync(srcPath, targetPath);

  // Copy lib/ if it exists
  const srcLibDir = join(hooksDir, 'lib');
  if (existsSync(srcLibDir)) {
    const dstLibDir = useGlobal
      ? hookCfg.globalLibPath()
      : hookCfg.libPath(opts.project);
    copyLibDir(srcLibDir, dstLibDir);
  }

  return {
    path: targetPath.replace(/\\/g, '/'),
    action: existed ? 'updated' : 'created',
    agent: agentName,
    name: hookFilename,
  };
}

/**
 * Export all hooks for a specific agent.
 * @returns {Array<{ path, action, agent, name }>}
 */
export function exportAllHooks(agentName, opts = {}, catalogRoot) {
  const hooks = discoverHooks(catalogRoot);
  const agentHooks = hooks.filter(h => h.agent === agentName);

  if (agentHooks.length === 0) return [];

  // Copy lib/ once (not per-hook)
  const root = catalogRoot || getPackageRoot();
  const srcLibDir = join(root, 'catalog', 'hooks', 'lib');
  if (existsSync(srcLibDir)) {
    const agentConfig = AGENTS[agentName];
    if (agentConfig?.hooks) {
      const hookCfg = agentConfig.hooks;
      const useGlobal = opts.global || !opts.project;
      const dstLibDir = useGlobal
        ? hookCfg.globalLibPath()
        : hookCfg.libPath(opts.project);
      copyLibDir(srcLibDir, dstLibDir);
    }
  }

  const results = agentHooks.map(hook => {
    try {
      return exportHook(hook.filename, agentName, opts, catalogRoot);
    } catch (err) {
      return { path: '', action: 'error', agent: agentName, name: hook.filename, reason: err.message };
    }
  });

  // Auto-write MCP configs on global export (agent-specific)
  const useGlobal = opts.global || !opts.project;
  if (useGlobal) {
    if (agentName === 'gemini') results.push(...writeGeminiMcpConfigs());
    if (agentName === 'cursor') results.push(...writeCursorMcpConfig());
  }

  return results;
}
