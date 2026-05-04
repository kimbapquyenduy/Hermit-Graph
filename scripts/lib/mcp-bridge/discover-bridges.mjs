/**
 * discover-bridges.mjs — Read and validate bridge config from disk.
 *
 * Config location (in priority order):
 *   1. HERMIT_BRIDGES_PATH env var
 *   2. ~/.hermit/mcp-bridges.json
 *
 * Returns { valid: BridgeConfig[], invalid: { entry, error }[] }.
 * Never throws — errors are logged and returned in `invalid` array.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { BridgeConfigSchema } from './bridge-config-schema.mjs';

const userHome = process.env.USERPROFILE || process.env.HOME || '';

/**
 * Resolve the bridges config file path.
 * @returns {string}
 */
export function resolveBridgesPath() {
  if (process.env.HERMIT_BRIDGES_PATH) return process.env.HERMIT_BRIDGES_PATH;
  return join(userHome, '.hermit', 'mcp-bridges.json');
}

/**
 * @typedef {import('./bridge-config-schema.mjs').BridgeConfig} BridgeConfig
 * @typedef {{ entry: unknown, error: string }} InvalidEntry
 */

/**
 * Read, parse, and validate the bridges config file.
 *
 * @param {string} [configPath] - Override path (used in tests)
 * @returns {{ valid: BridgeConfig[], invalid: InvalidEntry[] }}
 */
export function discoverBridges(configPath) {
  const filePath = configPath ?? resolveBridgesPath();

  if (!existsSync(filePath)) {
    return { valid: [], invalid: [] };
  }

  let raw;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    process.stderr.write(`[hermit:bridges] cannot read config file: ${err.message}\n`);
    return { valid: [], invalid: [{ entry: null, error: err.message }] };
  }

  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`[hermit:bridges] malformed JSON in ${filePath}: ${err.message}\n`);
    return { valid: [], invalid: [{ entry: raw, error: `JSON parse error: ${err.message}` }] };
  }

  if (!Array.isArray(entries)) {
    const msg = 'bridges config must be a JSON array';
    process.stderr.write(`[hermit:bridges] ${msg}\n`);
    return { valid: [], invalid: [{ entry: entries, error: msg }] };
  }

  const valid = [];
  const invalid = [];
  const seenNames = new Set();

  for (const entry of entries) {
    const result = BridgeConfigSchema.safeParse(entry);
    if (!result.success) {
      const error = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      process.stderr.write(`[hermit:bridges] skipping invalid entry: ${error}\n`);
      invalid.push({ entry, error });
      continue;
    }

    const cfg = result.data;

    if (seenNames.has(cfg.name)) {
      const error = `duplicate bridge name '${cfg.name}'`;
      process.stderr.write(`[hermit:bridges] ${error}\n`);
      invalid.push({ entry, error });
      continue;
    }

    seenNames.add(cfg.name);
    valid.push(cfg);
  }

  return { valid, invalid };
}
