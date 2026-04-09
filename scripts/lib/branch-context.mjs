/**
 * Branch Context — git branch detection + session-scoped filter state.
 * Used by intelligence-module (hermit_branch_context) and memory search tools.
 */

import { execSync } from 'child_process';

/** Session-scoped branch filter (resets on server restart). */
let _branchFilter = null;

/**
 * Detect current git branch via subprocess.
 * @param {string} cwd
 * @returns {string} Branch name or 'unknown'
 */
export function detectBranch(cwd = process.cwd()) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd, encoding: 'utf-8', timeout: 5000,
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function getBranchFilter() { return _branchFilter; }
export function setBranchFilter(branch) { _branchFilter = branch || null; }
export function clearBranchFilter() { _branchFilter = null; }

/**
 * Check if an observation is visible under the current branch filter.
 * - No filter → show all
 * - _branch=null → always visible (global)
 * - _branch matches filter → visible
 * - _branch is different → hidden
 * @param {string|object} obs
 * @param {string|null} branchFilter
 * @returns {boolean}
 */
export function isObservationVisible(obs, branchFilter) {
  if (!branchFilter) return true;
  const obsBranch = typeof obs === 'object' ? (obs._branch || null) : null;
  return obsBranch === null || obsBranch === branchFilter;
}
