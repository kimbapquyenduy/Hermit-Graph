/**
 * circuit-breaker.mjs — Per-bridge failure tracker.
 *
 * Opens after 3 consecutive failures; auto-recovers after 5 minutes of silence.
 * Manual reset via reset(name) — used by hermit_enable_bridge tool.
 *
 * All state is in-memory. A Brain restart clears all breaker state.
 */

const FAIL_THRESHOLD = 3;
const AUTO_RECOVER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * @typedef {Object} BreakerState
 * @property {number} consecutiveFails
 * @property {number} lastFailAt  - epoch ms of most recent failure (0 if never)
 */

export class CircuitBreaker {
  constructor() {
    /** @type {Map<string, BreakerState>} */
    this._state = new Map();
  }

  /**
   * Record a call outcome for a bridge.
   *
   * @param {string} name - Bridge name
   * @param {boolean} ok  - true = success, false = failure
   */
  record(name, ok) {
    const s = this._ensure(name);
    if (ok) {
      s.consecutiveFails = 0;
    } else {
      s.consecutiveFails++;
      s.lastFailAt = Date.now();
    }
  }

  /**
   * Check if the circuit is open (bridge should be blocked).
   * Auto-recovers after AUTO_RECOVER_MS since last failure.
   *
   * @param {string} name
   * @returns {boolean}
   */
  isOpen(name) {
    const s = this._state.get(name);
    if (!s || s.consecutiveFails < FAIL_THRESHOLD) return false;

    // Auto-recovery: if 5min elapsed since last fail, reset silently
    if (s.lastFailAt > 0 && Date.now() - s.lastFailAt >= AUTO_RECOVER_MS) {
      s.consecutiveFails = 0;
      s.lastFailAt = 0;
      return false;
    }

    return true;
  }

  /**
   * Manually reset a bridge's failure counter (called by hermit_enable_bridge).
   *
   * @param {string} name
   */
  reset(name) {
    const s = this._ensure(name);
    s.consecutiveFails = 0;
    s.lastFailAt = 0;
  }

  /**
   * Return current consecutive fail count for a bridge.
   *
   * @param {string} name
   * @returns {number}
   */
  failCount(name) {
    return this._state.get(name)?.consecutiveFails ?? 0;
  }

  /** @param {string} name @returns {BreakerState} */
  _ensure(name) {
    if (!this._state.has(name)) {
      this._state.set(name, { consecutiveFails: 0, lastFailAt: 0 });
    }
    return this._state.get(name);
  }
}
