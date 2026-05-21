/**
 * Phase 01 — symbol ID generation.
 *
 * Default mode keeps the legacy `${file}::${name}` format for v7 back-compat.
 * Setting HERMIT_ID_MODE=sha256 switches to a collision-safe SHA256-based ID
 * format: `${kind}:${sha256(file:kind:name:line).slice(0,32)}`.
 *
 * The legacy format collides on overloaded methods (Java) and reuses paths
 * verbosely. SHA256 mode is opt-in until a migration is ready.
 */

import { createHash } from 'crypto';

/**
 * Make a stable symbol ID.
 * @param {object} args — { file, kind, name, line, parent? }
 * @returns {string}
 */
export function makeSymbolId({ file, kind, name, line, parent }) {
  const mode = (process.env.HERMIT_ID_MODE || 'legacy').toLowerCase();
  if (mode === 'sha256') {
    const lineStart = Array.isArray(line) ? line[0] : (line || 0);
    const parentPart = parent ? `${parent}.` : '';
    const hash = createHash('sha256')
      .update(`${file}:${kind}:${parentPart}${name}:${lineStart}`)
      .digest('hex')
      .slice(0, 32);
    return `${kind}:${hash}`;
  }
  // legacy: file::name with optional parent qualifier (matches existing format)
  return parent ? `${file}::${parent}.${name}` : `${file}::${name}`;
}

/**
 * Current ID mode (introspection helper for tests/CLI).
 */
export function idMode() {
  return (process.env.HERMIT_ID_MODE || 'legacy').toLowerCase();
}
