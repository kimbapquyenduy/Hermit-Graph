#!/usr/bin/env node
/**
 * kg-auto-recall-gemini.cjs — Gemini CLI BeforeAgent Hook
 *
 * Thin adapter: reads stdin JSON {prompt, cwd, hook_event_name},
 * calls recall-core.recall(), outputs Gemini CLI hookSpecificOutput format.
 *
 * Gemini CLI BeforeAgent stdin: {prompt, session_id, cwd, hook_event_name, timestamp}
 * Gemini CLI BeforeAgent stdout: {hookSpecificOutput: {additionalContext: "..."}}
 *
 * Uses recall() for task-aware features: detectPromptType, extractTaskKeywords,
 * expandRelations, TASK_TOKEN_CAP.
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
    require('./lib/sqlite-bridge.cjs').bindHookContext(payload, 'gemini-cli');
    const prompt = payload.prompt || '';
    if (prompt.length < 10) process.exit(0);

    if (payload.cwd) process.env.CWD = payload.cwd;

    const output = core.recall(prompt);

    // Gemini CLI BeforeAgent: hookSpecificOutput.additionalContext
    if (output) {
      console.log(JSON.stringify({
        hookSpecificOutput: { additionalContext: output }
      }));
    }
    process.exit(0);
  } catch (error) { require('./lib/sqlite-bridge.cjs').reportHookFailure(error); process.exit(0); }
}

main();
