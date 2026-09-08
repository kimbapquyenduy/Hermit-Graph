/**
 * redact-secrets.mjs — strip credentials from text before it reaches a report.
 *
 * Session transcripts are the most sensitive data on the machine: raw tool
 * output can contain API keys, connection strings and tokens. Any feature that
 * reads transcripts MUST redact before writing anything to disk. This is a hard
 * gate, not a nicety — an audit of real sessions found a plaintext credential
 * in old raw tool output.
 *
 * Redaction is deliberately over-eager: a false positive costs a masked string
 * in a diagnostic report, a false negative leaks a secret.
 */

const REDACTED = '[REDACTED]';

/**
 * Patterns are ordered most-specific first so a provider key is labelled as
 * such rather than caught by the generic assignment rule.
 * @type {Array<{name: string, re: RegExp}>}
 */
const PATTERNS = [
  // Provider-shaped keys
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai-key', re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{16,}/g },
  { name: 'google-key', re: /AIza[0-9A-Za-z_-]{20,}/g },
  { name: 'slack-token', re: /xox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'stripe-key', re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  // Structured credentials
  { name: 'private-key-block', re: /-----BEGIN[^-]{0,40}PRIVATE KEY-----[\s\S]*?-----END[^-]{0,40}PRIVATE KEY-----/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: 'bearer-token', re: /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{16,}=*/g },
  { name: 'basic-auth-url', re: /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/g },
  // The (?!\[REDACTED\]) guards keep these idempotent: without them, redacted
  // output still "looks like" a secret assignment, so hasSecret() would report
  // a leak on already-clean text.
  { name: 'db-conn-password', re: /\b(?:Password|PWD)\s*=\s*(?!\[REDACTED\])[^;\s"']{3,}/gi },
  // Generic assignments — last resort, catches env dumps and CLI flags
  { name: 'assigned-secret', re: /\b(?:api[-_]?key|apikey|secret|token|password|passwd|access[-_]?key|private[-_]?key|client[-_]?secret)\b\s*[:=]\s*["']?(?!\[REDACTED\])[^\s"',;}]{6,}/gi },
];

/**
 * Redact secrets in a string.
 * @param {string} text
 * @returns {{ text: string, hits: Record<string, number> }}
 */
export function redact(text) {
  if (typeof text !== 'string' || !text) return { text: text ?? '', hits: {} };
  let out = text;
  const hits = {};
  for (const { name, re } of PATTERNS) {
    out = out.replace(re, (match) => {
      hits[name] = (hits[name] || 0) + 1;
      // Keep the assignment key visible so a report still says WHAT was masked.
      const sep = match.match(/\s*[:=]\s*/);
      if (name === 'assigned-secret' && sep) {
        return match.slice(0, match.indexOf(sep[0]) + sep[0].length) + REDACTED;
      }
      if (name === 'bearer-token') return `Bearer ${REDACTED}`;
      if (name === 'basic-auth-url') {
        const scheme = match.slice(0, match.indexOf('://') + 3);
        return `${scheme}${REDACTED}@`;
      }
      if (name === 'db-conn-password') {
        return `${match.split(/[:=]/)[0]}=${REDACTED}`;
      }
      return REDACTED;
    });
  }
  return { text: out, hits };
}

/**
 * Convenience wrapper when only the cleaned text is needed.
 * @param {string} text
 * @returns {string}
 */
export function redactText(text) {
  return redact(text).text;
}

/**
 * True when the text still looks like it contains a secret. Used by tests to
 * assert reports are clean.
 * @param {string} text
 * @returns {boolean}
 */
export function hasSecret(text) {
  return Object.keys(redact(text).hits).length > 0;
}
