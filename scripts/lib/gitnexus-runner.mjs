/**
 * GitNexus CLI subprocess runner — shared by codegraph-module and unified-search.
 * Shells out to `npx gitnexus` with configurable timeout.
 */

import { spawn } from 'child_process';
import { resolve as resolvePath } from 'path';

const TIMEOUT_MS = 30000;
const ALLOWED_CMDS = new Set(['query', 'context', 'impact', 'detect-changes', 'analyze']);
const SHELL_META = /[;&|`$(){}!<>]/;

/** Reject strings containing shell metacharacters. */
function sanitizeArg(arg) {
  if (SHELL_META.test(arg)) throw new Error(`Invalid characters in argument: ${arg.slice(0, 40)}`);
  return arg;
}

/**
 * Run a GitNexus CLI command as subprocess.
 * @param {string} cmd - GitNexus subcommand (query, context, impact, detect-changes)
 * @param {string[]} args - CLI arguments
 * @param {string} cwd - Working directory (git repo root)
 * @returns {Promise<string>} stdout output
 */
export function runGitNexus(cmd, args = [], cwd = process.cwd()) {
  if (!ALLOWED_CMDS.has(cmd)) throw new Error(`Unknown GitNexus command: ${cmd}`);
  const safeCwd = resolvePath(sanitizeArg(cwd));
  const safeArgs = args.map(a => sanitizeArg(a));

  return new Promise((resolve, reject) => {
    // shell: true required on Windows for npx .cmd shim
    const proc = spawn('npx', ['gitnexus', cmd, ...safeArgs], {
      cwd: safeCwd,
      timeout: TIMEOUT_MS,
      shell: true,
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
