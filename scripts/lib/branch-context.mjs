/**
 * Branch Context — git branch detection.
 *
 * This module used to carry a session-scoped "branch filter" that hid
 * observations tagged with a different branch. It was removed: the filter was
 * set by session_start but never read by any search path (only by tests), and
 * the graph had zero branch-tagged observations, so it could only ever be a
 * no-op. Finishing it would have been worse than removing it — a memory system
 * that silently hides knowledge when you switch branches loses recall, and
 * almost no stored knowledge is genuinely branch-specific.
 *
 * Branch detection itself is kept: session_start reports it, which is useful.
 */

import { execSync } from 'child_process';

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
