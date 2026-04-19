/**
 * Zod coercion helpers for MCP tool schemas.
 *
 * Some MCP clients (Cursor, Cline, certain bridges) serialize all tool-call
 * arguments as strings over stdio transport. Strict z.number()/z.boolean()/
 * z.array() schemas reject such input with "expected X, received string".
 *
 * These helpers coerce stringified primitives/JSON back to their intended
 * types BEFORE zod's shape validation. Constraints (min/max/enum/minLength)
 * still run post-coerce, so validity is preserved.
 *
 * Correctly-typed clients (Claude Code) see zero behavior change.
 */

import { z } from 'zod';

/** Number schema accepting numeric input or a stringified number. */
export function zNumber() {
  return z.coerce.number();
}

/** Boolean schema accepting true/false or "true"/"false" strings. */
export function zBoolean() {
  return z.preprocess((v) => {
    if (typeof v === 'string') {
      if (v === 'true') return true;
      if (v === 'false') return false;
    }
    return v;
  }, z.boolean());
}

/**
 * Array schema accepting an array or a JSON-stringified array.
 *
 * Array constraints are passed as options instead of chained methods because
 * z.preprocess returns a pipeline wrapper that doesn't expose ZodArray methods.
 *
 * @param inner Zod schema for array elements.
 * @param {{min?: number, max?: number}} [opts] Optional length constraints.
 */
export function zArray(inner, opts = {}) {
  let schema = z.array(inner);
  if (opts.min !== undefined) schema = schema.min(opts.min);
  if (opts.max !== undefined) schema = schema.max(opts.max);
  return z.preprocess((v) => {
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // fall through — let z.array reject with its native error
      }
    }
    return v;
  }, schema);
}
