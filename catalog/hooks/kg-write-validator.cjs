#!/usr/bin/env node
/**
 * kg-write-validator.cjs — PreToolUse Hook
 *
 * Validates KG write operations to ensure data quality:
 * 1. Observations MUST have [confidence|YYYY-MM-DD] prefix
 * 2. Entity names SHOULD follow TIER:SCOPE:LABEL format (warning only)
 *
 * Targets: hermit_create_entities, hermit_add_observations
 *
 * Setup: Add to settings.json → hooks.PreToolUse:
 *   { "matcher": "*", "hooks": [{ "type": "command", "command": "node catalog/hooks/kg-write-validator.cjs" }] }
 *
 * The hook checks tool_name internally (substring match on "hermit_create_entities"
 * and "hermit_add_observations") — exits immediately for non-matching tools.
 *
 * Exit Codes:
 *   0 - Allowed (non-matching tool or valid input)
 *   2 - Blocked (invalid observations)
 */

const fs = require('fs');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

// Tools to validate — substring match against tool_name
const WRITE_TOOLS = ['hermit_create_entities', 'hermit_add_observations'];

// Observation prefix: [confidence|YYYY-MM-DD]
const OBS_PREFIX_RE = /^\[[\d.]+\|\d{4}-\d{2}-\d{2}\]/;

// Entity name: TIER:SCOPE:LABEL (at least 2 colon-separated parts)
const ENTITY_NAME_RE = /^[A-Z]+:[^:]+:.+$/;

// Valid tier prefixes
const VALID_TIERS = new Set([
  'BIZ', 'RULE', 'FLOW', 'ENTITY',
  'PATTERN', 'TECH', 'INCIDENT', 'GOTCHA',
  'FEATURE',
]);

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function extractObsText(obs) {
  if (typeof obs === 'string') return obs;
  if (typeof obs === 'object' && obs !== null) return obs.content || '';
  return String(obs);
}

function validateCreateEntities(toolInput) {
  const errors = [];
  const warnings = [];
  const entities = toolInput.entities || [];

  for (const entity of entities) {
    const name = entity.name || '';

    // Entity name format check (warning, not error)
    if (name && !ENTITY_NAME_RE.test(name)) {
      warnings.push(`Entity "${name}" doesn't follow TIER:SCOPE:LABEL format`);
    } else if (name) {
      const tier = name.split(':')[0];
      if (!VALID_TIERS.has(tier)) {
        warnings.push(`Entity "${name}" uses unknown tier "${tier}"`);
      }
    }

    // Observation prefix check (error — blocks write)
    for (const obs of (entity.observations || [])) {
      const text = extractObsText(obs);
      if (text && !OBS_PREFIX_RE.test(text)) {
        errors.push(`Missing [confidence|date] prefix: "${text.slice(0, 60)}"`);
      }
    }
  }

  return { errors, warnings };
}

function validateAddObservations(toolInput) {
  const errors = [];
  const observations = toolInput.observations || [];

  for (const obs of observations) {
    const text = extractObsText(obs);
    if (text && !OBS_PREFIX_RE.test(text)) {
      errors.push(`Missing [confidence|date] prefix: "${text.slice(0, 60)}"`);
    }
  }

  return { errors, warnings: [] };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) { allow(); return; }

    const hookData = JSON.parse(stdin);
    const toolName = hookData.tool_name || '';

    // Early exit — not a hermit write tool
    if (!WRITE_TOOLS.some(t => toolName.includes(t))) {
      allow();
      return;
    }

    const toolInput = hookData.tool_input || {};
    let result;

    if (toolName.includes('hermit_create_entities')) {
      result = validateCreateEntities(toolInput);
    } else if (toolName.includes('hermit_add_observations')) {
      result = validateAddObservations(toolInput);
    } else {
      allow();
      return;
    }

    // Block if errors found
    if (result.errors.length > 0) {
      const lines = [
        '## KG Write Validation Failed',
        '',
        '**Errors (must fix):**',
        ...result.errors.map(e => `- ${e}`),
      ];

      if (result.warnings.length > 0) {
        lines.push('', '**Warnings:**', ...result.warnings.map(w => `- ${w}`));
      }

      lines.push(
        '',
        '**Required format:**',
        '- Observations: `[confidence|YYYY-MM-DD] TEXT` (e.g., `[0.8|2026-04-09] RULE: Max discount 50%`)',
        '- Entity names: `TIER:SCOPE:LABEL` (e.g., `BIZ:ProjectName:Description`)',
        '- Confidence: 0.6 (auto-detected), 0.8 (default), 0.95 (user-stated)',
        '',
        'Fix the observations and retry.',
      );

      block(lines.join('\n'));
      return;
    }

    // Warnings only — allow but stderr log
    if (result.warnings.length > 0) {
      process.stderr.write(`[kg-write-validator] Warnings: ${result.warnings.join('; ')}\n`);
    }

    allow();
  } catch (e) {
    // Fail-open — never block on hook errors
    process.stderr.write(`[kg-write-validator] Error: ${e.message}\n`);
    allow();
  }
}

function allow() {
  process.exit(0);
}

function block(reason) {
  console.log(JSON.stringify({ decision: 'block', reason }));
  process.exit(2);
}

main();
