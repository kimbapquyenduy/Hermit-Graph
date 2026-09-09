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
const { shouldFireRecall } = require('./lib/recall-gate.cjs');

function main() {
  try {
    const stdin = require('fs').readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    require('./lib/sqlite-bridge.cjs').bindHookContext(payload, 'claude');
    const prompt = payload.tool_input?.prompt || payload.prompt || '';
    if (prompt.length < 10) process.exit(0);

    // F10 conditional auto-recall — gate on prompt content. Saves ~1500 tokens
    // on trivial sessions (typo fixes, casual chat, "what time is it").
    // Env: HERMIT_AUTORECALL=always bypasses gating; =off disables entirely;
    //      HERMIT_AUTORECALL_LOG=1 logs skip decisions to stderr.
    const { fire, reason } = shouldFireRecall(prompt);
    if (!fire) {
      if (process.env.HERMIT_AUTORECALL_LOG === '1') {
        process.stderr.write(`[kg-auto-recall] skip: ${reason}\n`);
      }
      process.exit(0);
    }

    // Use payload.cwd for scope detection (SubagentStart provides cwd)
    if (payload.cwd) process.env.CWD = payload.cwd;

    const output = core.recall(prompt);
    if (output) console.log(output);
    process.exit(0);
  } catch (error) { require('./lib/sqlite-bridge.cjs').reportHookFailure(error); process.exit(0); }
}

main();
