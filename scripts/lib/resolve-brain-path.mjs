/**
 * Resolve the brain.jsonl path for both git clone and npm install modes.
 *
 * Priority:
 *   1. MEMORY_FILE_PATH env variable (explicit override)
 *   2. <repo>/data/brain.jsonl (git clone mode — repo has .git dir)
 *   3. ~/.hermit-graph/data/brain.jsonl (npm install mode — default user data dir)
 *
 * Always returns forward slashes for cross-platform MCP compatibility.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..', '..');
const userHome = process.env.USERPROFILE || process.env.HOME || '';

/**
 * Check if packageRoot is a git clone (has .git directory)
 * vs npm-installed (inside node_modules).
 */
function isGitClone() {
  return existsSync(join(packageRoot, '.git'));
}

/**
 * Resolve brain.jsonl path.
 * @returns {string} Absolute path with forward slashes
 */
export function resolveBrainPath() {
  // 1. Explicit env override
  if (process.env.MEMORY_FILE_PATH) {
    return process.env.MEMORY_FILE_PATH.replace(/\\/g, '/');
  }

  // 2. Git clone mode — data lives in repo
  if (isGitClone()) {
    return join(packageRoot, 'data', 'brain.jsonl').replace(/\\/g, '/');
  }

  // 3. npm install mode — data lives in user home
  return join(userHome, '.hermit-graph', 'data', 'brain.jsonl').replace(/\\/g, '/');
}

/**
 * Get the package root directory (hermit-graph installation).
 * @returns {string} Absolute path
 */
export function getPackageRoot() {
  return packageRoot;
}

/**
 * Check installation mode.
 * @returns {'git-clone' | 'npm-install'}
 */
export function getInstallMode() {
  return isGitClone() ? 'git-clone' : 'npm-install';
}
