/**
 * Shared parser for observation prefixes: [confidence|date]
 * Handles three formats:
 *   [0.8|2026-03-26] RULE: text   → full prefix
 *   [0.8] RULE: text              → confidence only
 *   RULE: text                    → legacy (no prefix)
 */

// Matches [confidence] or [confidence|YYYY-MM-DD] at start of observation
const PREFIX_RE = /^\[(\d\.?\d*?)(?:\|(\d{4}-\d{2}-\d{2}))?\]\s*/;

/**
 * Parse an observation string into structured components
 * @param {string} obs - Raw observation text
 * @returns {{ confidence: number, date: string|null, text: string }}
 */
export function parseObservation(obs) {
  const match = obs.match(PREFIX_RE);
  if (match) {
    return {
      confidence: Math.min(parseFloat(match[1]), 1.0),
      date: match[2] || null,
      text: obs.replace(PREFIX_RE, '')
    };
  }
  // Legacy: no prefix → default confidence 0.8, no date
  return { confidence: 0.8, date: null, text: obs };
}

/**
 * Format an observation with prefix
 * @param {string} text - Observation text (without prefix)
 * @param {number} confidence - Confidence score 0.0-1.0
 * @param {string|null} date - ISO date string or null
 * @returns {string}
 */
export function formatObservation(text, confidence = 0.8, date = null) {
  const conf = Math.min(Math.max(confidence, 0), 1.0);
  if (date) return `[${conf}|${date}] ${text}`;
  return `[${conf}] ${text}`;
}

/**
 * Calculate decayed confidence based on age
 * Half-life ~70 days (decay rate 0.01)
 * @param {number} initial - Initial confidence
 * @param {string|null} dateStr - ISO date string
 * @returns {number}
 */
export function decayedConfidence(initial, dateStr) {
  if (!dateStr) return initial;
  const days = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  if (days < 0) return initial; // future date, no decay
  return initial * Math.exp(-0.01 * days);
}

/**
 * Check if an observation is stale (>threshold days old)
 * @param {string|null} dateStr - ISO date string
 * @param {number} thresholdDays - Days before considered stale (default 180)
 * @returns {boolean}
 */
export function isStale(dateStr, thresholdDays = 180) {
  if (!dateStr) return false; // no date = unknown age, not stale
  const days = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  return days > thresholdDays;
}

/**
 * Get age in days for a dated observation
 * @param {string|null} dateStr - ISO date string
 * @returns {number|null}
 */
export function staleDays(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

/**
 * Get today's date as ISO string (YYYY-MM-DD)
 * @returns {string}
 */
export function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get hex color for confidence badge
 * @param {number} conf - Confidence score 0.0-1.0
 * @returns {string} Hex color
 */
export function confidenceColor(conf) {
  if (conf < 0.3) return '#EF4444'; // red
  if (conf < 0.7) return '#F59E0B'; // yellow
  return '#10B981';                  // green
}
