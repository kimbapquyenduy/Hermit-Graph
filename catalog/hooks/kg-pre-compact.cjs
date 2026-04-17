#!/usr/bin/env node
/**
 * kg-pre-compact.cjs — PreCompact hook for Claude Code.
 *
 * Injects a reminder to save unsaved KG entities before compaction.
 * Lightweight: static prompt output, no brain.jsonl reads.
 *
 * Exit Codes:
 *   0 - Always (never abort compaction)
 */

'use strict';

const REMINDER = `Before compacting, check if any of these should be saved to Knowledge Graph:
- Business rules or flows discovered during this session
- Architecture decisions or patterns identified
- Bug fixes or gotchas encountered (especially if debugging took >5 min)
- Tech stack or config changes made
Use hermit_create_entities with [confidence|YYYY-MM-DD] observation format.
Naming: TIER:SCOPE:LABEL (e.g., RULE:Project:MaxDiscount, PATTERN:ARCH:ServiceLayer).`;

try {
  require('fs').readFileSync(0, 'utf-8');
  console.log(REMINDER);
} catch { /* ignore */ }

process.exit(0);
