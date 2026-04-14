#!/usr/bin/env node
/**
 * session-hook-cursor.cjs — Cursor session lifecycle hook.
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

    if (event === 'end' || event === 'onSessionEnd') {
      endSession(cwd);
    } else {
      startSession(cwd, 'cursor');
    }
    process.exit(0);
  } catch { process.exit(0); }
}
main();
