#!/usr/bin/env node
/**
 * kg-auto-recall-codex.cjs — Codex CLI Hook
 *
 * Thin adapter: reads stdin JSON {prompt}, calls recall-core, outputs plain text.
 * Codex CLI uses the same plain-text stdout format as Claude Code.
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
    const prompt = payload.prompt || payload.message || '';
    if (prompt.length < 10) process.exit(0);

    const keywords = core.extractKeywords(prompt);
    if (!keywords.length) process.exit(0);

    const cwd = payload.cwd || '';
    const scope = cwd
      ? core.detectProjectScopeFromPath(cwd)
      : core.detectProjectScope();
    const results = core.searchBrain(keywords, scope);
    const output = core.formatResults(results, keywords, scope);

    if (output) console.log(output);
    process.exit(0);
  } catch { process.exit(0); }
}

main();
