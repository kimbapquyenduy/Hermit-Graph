#!/usr/bin/env node
/**
 * kg-auto-update.cjs — Claude Code Stop Hook
 *
 * Fires on session end. Scans assistant messages for extractable entities
 * (tech decisions, error patterns, explicit refs) and captures candidates in SQLite.
 *
 * Stdin: { session_id, conversation: [{role, content}], ... }
 * Stdout: (none — Stop hooks are non-blocking)
 * Stderr: extraction summary for debugging
 *
 * Env:
 *   HERMIT_AUTO_UPDATE=false  — disable entirely (default: true)
 *
 * Exit Codes:
 *   0 - Always (non-blocking — never fail the session close)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./lib/recall-core.cjs');
const extractor = require('./lib/entity-extractor.cjs');

function main() {
  // 5-second timeout guard — never block session close
  setTimeout(() => {
    process.stderr.write('[hermit] kg-auto-update: timed out (5s)\n');
    process.exit(0);
  }, 5000).unref();

  try {
    // Check kill switch
    if (process.env.HERMIT_AUTO_UPDATE === 'false') process.exit(0);

    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);

    const payload = JSON.parse(stdin);

    // Extract assistant messages from conversation
    const messages = payload.conversation || payload.messages || [];
    const assistantText = messages
      .filter(m => m.role === 'assistant')
      .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      .join('\n\n');

    if (assistantText.length < 50) process.exit(0);

    // Detect project name from CWD (PascalCase for consistent KG naming)
    const cwd = payload.cwd || process.env.CWD || process.cwd();
    process.env.CWD = cwd;
    const projectName = path.basename(cwd)
      .split(/[\s\-_]+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');

    // Extract entities
    const entities = extractor.extractEntities(assistantText, projectName);
    if (entities.length === 0) {
      process.stderr.write('[hermit] kg-auto-update: no entities extracted\n');
      process.exit(0);
    }

    // Filter against existing brain
    const brainPath = core.resolveBrainPath();
    const newEntities = extractor.filterExisting(entities, brainPath);
    if (newEntities.length === 0) {
      process.stderr.write(`[hermit] kg-auto-update: ${entities.length} extracted, all already in KG\n`);
      process.exit(0);
    }

    // Append to brain
    const written = extractor.appendToBrain(newEntities, brainPath);
    process.stderr.write(`[hermit] kg-auto-update: ${written} new entities written (${entities.length} extracted, ${entities.length - newEntities.length} dupes skipped)\n`);
    for (const e of newEntities) {
      process.stderr.write(`  + ${e.name} (${e.entityType})\n`);
    }

    process.exit(0);
  } catch (err) {
    process.stderr.write(`[hermit] kg-auto-update error: ${err.message}\n`);
    process.exit(0); // Never block session close
  }
}

main();
