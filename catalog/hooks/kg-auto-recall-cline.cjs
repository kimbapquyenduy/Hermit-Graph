#!/usr/bin/env node
/**
 * kg-auto-recall-cline.cjs — Cline UserPromptSubmit Hook
 *
 * Thin adapter: reads stdin JSON {message, cwd}, calls recall-core, outputs JSON {contextModification}.
 * Cline uses "message" (not "prompt") in stdin and "contextModification" in stdout.
 * If a cwd field is provided, it is used for project scope detection instead of process.cwd().
 * All core logic lives in lib/recall-core.cjs.
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
    const cwd = payload.cwd || '';
    if (prompt.length < 10) process.exit(0);

    const keywords = core.extractKeywords(prompt);
    if (!keywords.length) process.exit(0);

    // Use provided CWD for scope detection if available
    const scope = cwd
      ? core.detectProjectScopeFromPath(cwd)
      : core.detectProjectScope();
    const results = core.searchBrain(keywords, scope);
    const output = core.formatResults(results, keywords, scope);

    // Cline: JSON stdout with contextModification field
    if (output) {
      console.log(JSON.stringify({ contextModification: output }));
    }
    process.exit(0);
  } catch { process.exit(0); }
}

main();
