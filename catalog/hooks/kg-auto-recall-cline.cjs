#!/usr/bin/env node
/**
 * kg-auto-recall-cline.cjs — Cline UserPromptSubmit Hook
 *
 * Thin adapter: reads stdin JSON {message, cwd}, calls recall-core.recall(),
 * outputs JSON {contextModification}.
 * Cline uses "message" (not "prompt") in stdin and "contextModification" in stdout.
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
    const prompt = payload.message || payload.prompt || '';
    if (prompt.length < 10) process.exit(0);

    if (payload.cwd) process.env.CWD = payload.cwd;

    const output = core.recall(prompt);

    // Cline: JSON stdout with contextModification field
    if (output) {
      console.log(JSON.stringify({ contextModification: output }));
    }
    process.exit(0);
  } catch { process.exit(0); }
}

main();
