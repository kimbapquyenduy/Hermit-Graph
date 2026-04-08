/**
 * Cross-process file locking for brain.jsonl concurrent access.
 * Uses lockfile (.lock) approach — no native deps.
 *
 * Strategy:
 * - Reads are lock-free (JSONL is append-friendly)
 * - Writes acquire exclusive lock via .lock file
 * - Lock includes PID + timestamp for stale lock detection
 * - Stale locks (>30s) are auto-broken
 *
 * Usage:
 *   import { acquireLock, releaseLock, withLock } from './file-lock.mjs';
 *   await withLock(filePath, async () => { ...write operations... });
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const LOCK_TIMEOUT_MS = 30000; // 30s stale lock threshold
const RETRY_INTERVAL_MS = 100; // Poll interval when waiting for lock
const MAX_RETRIES = 100; // Max wait = 10s (100 * 100ms)

/**
 * Get lock file path for a given file.
 */
function lockPath(filePath) {
  return filePath + '.lock';
}

/**
 * Create lock file content with agent ID and timestamp.
 */
function lockContent(agentId = 'unknown') {
  return JSON.stringify({
    pid: process.pid,
    agentId,
    timestamp: Date.now(),
    hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || 'local',
  });
}

/**
 * Check if a lock is stale (older than LOCK_TIMEOUT_MS).
 */
function isLockStale(lockFile) {
  try {
    const content = JSON.parse(readFileSync(lockFile, 'utf-8'));
    return (Date.now() - content.timestamp) > LOCK_TIMEOUT_MS;
  } catch {
    return true; // Malformed lock = stale
  }
}

/**
 * Acquire an exclusive lock on a file.
 * @param {string} filePath - Path to the file to lock
 * @param {string} agentId - Identifier for the agent acquiring the lock
 * @returns {Promise<boolean>} true if lock acquired
 */
export async function acquireLock(filePath, agentId = 'unknown') {
  const lock = lockPath(filePath);

  for (let i = 0; i < MAX_RETRIES; i++) {
    // Check if lock exists
    if (existsSync(lock)) {
      if (isLockStale(lock)) {
        // Break stale lock
        try { unlinkSync(lock); } catch { /* race condition ok */ }
      } else {
        // Wait and retry
        await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
        continue;
      }
    }

    // Try to create lock (atomic-ish via wx flag)
    try {
      writeFileSync(lock, lockContent(agentId), { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Another process got the lock first, retry
        await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
        continue;
      }
      throw err;
    }
  }

  return false; // Timeout
}

/**
 * Release a lock on a file.
 * @param {string} filePath - Path to the locked file
 */
export function releaseLock(filePath) {
  const lock = lockPath(filePath);
  try { unlinkSync(lock); } catch { /* already released */ }
}

/**
 * Execute a function while holding an exclusive lock.
 * @param {string} filePath - Path to the file to lock
 * @param {Function} fn - Async function to execute while locked
 * @param {string} agentId - Agent identifier
 * @returns {Promise<*>} Result of fn()
 */
export async function withLock(filePath, fn, agentId = 'unknown') {
  const acquired = await acquireLock(filePath, agentId);
  if (!acquired) {
    throw new Error(`Failed to acquire lock on ${filePath} after ${MAX_RETRIES * RETRY_INTERVAL_MS}ms`);
  }

  try {
    return await fn();
  } finally {
    releaseLock(filePath);
  }
}

/**
 * Get current lock status for a file.
 * @param {string} filePath
 * @returns {{ locked: boolean, agentId?: string, pid?: number, age?: number }}
 */
export function getLockStatus(filePath) {
  const lock = lockPath(filePath);
  if (!existsSync(lock)) return { locked: false };

  try {
    const content = JSON.parse(readFileSync(lock, 'utf-8'));
    return {
      locked: true,
      agentId: content.agentId,
      pid: content.pid,
      age: Date.now() - content.timestamp,
      stale: (Date.now() - content.timestamp) > LOCK_TIMEOUT_MS,
    };
  } catch {
    return { locked: true, stale: true };
  }
}

export { LOCK_TIMEOUT_MS, RETRY_INTERVAL_MS, MAX_RETRIES };
