#!/usr/bin/env node
/**
 * kg-auto-recall-gemini.cjs — Gemini CLI BeforeAgent Hook
 *
 * Thin adapter: reads stdin JSON {prompt, cwd, hook_event_name},
 * calls recall-core, outputs Gemini CLI hookSpecificOutput format.
 * All core logic lives in lib/recall-core.cjs.
 *
 * Gemini CLI BeforeAgent stdin: {prompt, session_id, cwd, hook_event_name, timestamp}
 * Gemini CLI BeforeAgent stdout: {hookSpecificOutput: {additionalContext: "..."}}
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
    const prompt = payload.prompt || '';
    if (prompt.length < 10) process.exit(0);

    const keywords = core.extractKeywords(prompt);
    if (!keywords.length) process.exit(0);

    // Use cwd from Gemini CLI payload for better scope detection
    const scope = payload.cwd
      ? core.detectProjectScopeFromPath(payload.cwd)
      : core.detectProjectScope();
    const results = core.searchBrain(keywords, scope);
    const output = core.formatResults(results, keywords, scope);

    // Gemini CLI BeforeAgent: hookSpecificOutput.additionalContext
    if (output) {
      console.log(JSON.stringify({
        hookSpecificOutput: { additionalContext: output }
      }));
    }
    process.exit(0);
  } catch { process.exit(0); }
}

main();
