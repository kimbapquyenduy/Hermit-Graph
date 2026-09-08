/**
 * with-timeout.mjs — bound a slow operation and degrade instead of hanging.
 *
 * Session telemetry (hermit doctor --sessions) measured hermit_query at a 262s
 * p95 and hermit_open_nodes hitting the agent's own 300s hard timeout. A tool
 * that hangs is worse than one that returns partial results: the agent gets
 * nothing and the call is charged anyway.
 */

/** Default budget for interactive tool calls. */
export const DEFAULT_TOOL_TIMEOUT_MS = Number(process.env.HERMIT_TOOL_TIMEOUT_MS || 30_000);

/** Marker attached to a fallback value so callers can label the response. */
export const TIMED_OUT = Symbol('hermit:timed-out');

/**
 * Race a promise against a timeout.
 * @template T
 * @param {Promise<T>|(() => Promise<T>)} work
 * @param {object} [opts]
 * @param {number} [opts.ms] - budget in milliseconds
 * @param {T} [opts.fallback] - value to resolve with on timeout
 * @returns {Promise<{ value: T, timedOut: boolean, elapsedMs: number }>}
 */
export async function withTimeout(work, opts = {}) {
  const ms = opts.ms ?? DEFAULT_TOOL_TIMEOUT_MS;
  const started = Date.now();
  let timer;
  const promise = typeof work === 'function' ? work() : work;
  try {
    const value = await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); }),
    ]);
    if (value === TIMED_OUT) {
      // Don't leave the slow work unhandled — it may still reject later.
      Promise.resolve(promise).catch(() => {});
      return { value: opts.fallback, timedOut: true, elapsedMs: Date.now() - started };
    }
    return { value, timedOut: false, elapsedMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
