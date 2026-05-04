/**
 * bridge-config-schema.mjs — Zod v4 schema for a single MCP bridge entry.
 *
 * Validation rules:
 *   - name: lowercase alphanumeric + underscore, starts with letter, max 32 chars
 *   - transport: 'stdio' (default) requires command; 'http' requires url
 *   - enabled: false by default (security posture — opt-in)
 */

import { z } from 'zod';

/** Raw shape (before refinement) */
const bridgeShape = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'name must match /^[a-z][a-z0-9_]*$/')
    .max(32, 'name must be ≤ 32 characters'),

  transport: z.enum(['stdio', 'http']).default('stdio'),

  // stdio fields
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),

  // http fields
  url: z.string().url('url must be a valid URL').optional(),
  headers: z.record(z.string(), z.string()).optional(),

  enabled: z.boolean().default(false),

  // Allow an ignored comment field in JSON configs
  _comment: z.string().optional(),
});

/**
 * Full bridge config schema with cross-field refinements.
 *
 * Refinements:
 *   - stdio transport requires `command`
 *   - http  transport requires `url`
 */
export const BridgeConfigSchema = bridgeShape.superRefine((val, ctx) => {
  if (val.transport === 'stdio' && !val.command) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['command'],
      message: 'command is required when transport is "stdio"',
    });
  }
  if (val.transport === 'http' && !val.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['url'],
      message: 'url is required when transport is "http"',
    });
  }
});

/** @typedef {z.infer<typeof BridgeConfigSchema>} BridgeConfig */
