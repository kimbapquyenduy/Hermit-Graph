#!/usr/bin/env node
/**
 * kg-auto-recall-cursor.cjs — Cursor onPromptSubmit Hook
 *
 * Thin adapter: reads stdin JSON {prompt}, calls recall-core, outputs plain text.
 * Cursor's hook format is identical to Claude Code (plain text stdout).
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
    const prompt = payload.prompt || '';
    if (prompt.length < 10) process.exit(0);

    const keywords = core.extractKeywords(prompt);
    if (!keywords.length) process.exit(0);

    const scope = core.detectProjectScope();
    const results = core.searchBrain(keywords, scope);
    const output = core.formatResults(results, keywords, scope);

    if (output) console.log(output);
    process.exit(0);
  } catch { process.exit(0); }
}

main();
