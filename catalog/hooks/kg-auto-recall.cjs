#!/usr/bin/env node
/**
 * kg-auto-recall.cjs — Claude Code UserPromptSubmit + SubagentStart Hook
 *
 * Thin adapter: reads stdin JSON, calls recall-core.recall(), outputs plain text.
 * Handles both event shapes:
 *   - UserPromptSubmit: { prompt: "..." }
 *   - SubagentStart:    { tool_input: { prompt: "..." }, cwd: "..." }
 *
 * Uses recall() instead of manual chain — activates task-aware features:
 *   - detectPromptType() → 'task' for SubagentStart (lower token cap)
 *   - extractTaskKeywords() → smarter keyword extraction for subagents
 *   - expandRelations() → depth-1 related entities
 *
 * Exit Codes:
 *   0 - Always (non-blocking — never fail the user's prompt)
 */

'use strict';

const core = require('./lib/recall-core.cjs');

function main() {
  try {
    const stdin = require('fs').readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    const prompt = payload.tool_input?.prompt || payload.prompt || '';
    if (prompt.length < 10) process.exit(0);

    // Use payload.cwd for scope detection (SubagentStart provides cwd)
    if (payload.cwd) process.env.CWD = payload.cwd;

    const output = core.recall(prompt);
    if (output) console.log(output);
    process.exit(0);
  } catch { process.exit(0); }
}

main();
