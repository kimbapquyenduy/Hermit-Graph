#!/usr/bin/env node
/**
 * session-hook-codex.cjs — Codex CLI session lifecycle hook.
 * Writes/updates .hermit/session.json on session start/end.
 */
'use strict';
const { startSession, endSession } = require('./lib/session-core.cjs');

function main() {
  try {
    const stdin = require('fs').readFileSync(0, 'utf-8').trim();
    const payload = stdin ? JSON.parse(stdin) : {};
    const cwd = payload.cwd || process.cwd();
    const event = payload.event || 'start';

    if (event === 'end' || event === 'SessionEnd') {
      endSession(cwd);
    } else {
      startSession(cwd, 'codex');
    }
    process.exit(0);
  } catch { process.exit(0); }
}
main();
