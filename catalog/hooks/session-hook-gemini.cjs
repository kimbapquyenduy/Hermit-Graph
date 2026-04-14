#!/usr/bin/env node
/**
 * session-hook-gemini.cjs — Gemini CLI session lifecycle hook.
 * Writes/updates .hermit/session.json on session start/end.
 *
 * Gemini CLI sends {hook_event_name, session_id, cwd, timestamp} in stdin.
 * Register separately under SessionStart and SessionEnd events in settings.json.
 */
'use strict';
const { startSession, endSession } = require('./lib/session-core.cjs');

function main() {
  try {
    const stdin = require('fs').readFileSync(0, 'utf-8').trim();
    const payload = stdin ? JSON.parse(stdin) : {};
    const cwd = payload.cwd || payload.workingDir || process.cwd();
    // Gemini CLI provides hook_event_name; fallback to legacy payload.event
    const event = payload.hook_event_name || payload.event || 'SessionStart';

    if (event === 'SessionEnd' || event === 'end') {
      endSession(cwd);
    } else {
      startSession(cwd, 'gemini');
    }
    process.exit(0);
  } catch { process.exit(0); }
}
main();
