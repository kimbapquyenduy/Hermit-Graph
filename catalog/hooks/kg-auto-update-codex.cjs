#!/usr/bin/env node
/**
 * kg-auto-update-codex.cjs — Codex Stop/SessionEnd Hook
 *
 * All core logic lives in lib/entity-extractor.cjs + lib/recall-core.cjs.
 *
 * Exit Codes:
 *   0 - Always (non-blocking)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./lib/recall-core.cjs');
const extractor = require('./lib/entity-extractor.cjs');

function main() {
  try {
    if (process.env.HERMIT_AUTO_UPDATE === 'false') process.exit(0);

    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);
    require('./lib/sqlite-bridge.cjs').bindHookContext(payload, 'codex');
    const messages = payload.conversation || payload.messages || [];
    const assistantText = messages
      .filter(m => m.role === 'assistant')
      .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      .join('\n\n');

    if (assistantText.length < 50) process.exit(0);

    const cwd = payload.cwd || process.env.CWD || process.cwd();
    process.env.CWD = cwd;
    const projectName = path.basename(cwd).replace(/[\s-_]/g, '');

    const entities = extractor.extractEntities(assistantText, projectName);
    if (!entities.length) process.exit(0);

    const brainPath = core.resolveBrainPath();
    const newEntities = extractor.filterExisting(entities, brainPath);
    if (!newEntities.length) process.exit(0);

    extractor.appendToBrain(newEntities, brainPath);
    process.stderr.write(`[hermit] kg-auto-update-codex: ${newEntities.length} new entities\n`);
    process.exit(0);
  } catch (error) { require('./lib/sqlite-bridge.cjs').reportHookFailure(error); process.exit(0); }
}

main();
