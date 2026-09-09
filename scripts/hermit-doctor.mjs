#!/usr/bin/env node
/**
 * hermit doctor — self-diagnosis from agent session transcripts.
 *
 * Built because the v7.1 P0 crash (`preloadSymbols` on a null pool) was only
 * found by a human parsing 487 Codex session files by hand. This makes that a
 * command: which tools fail, how often, how slow, and what the recurring
 * error fingerprints are.
 *
 * Usage:
 *   node scripts/hermit-doctor.mjs --sessions [--days N] [--root DIR]
 *                                  [--tool-prefix hermit_] [--out report.md]
 *
 * Every string extracted from a transcript passes through secret redaction
 * before it can reach stdout or a file.
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { collectSessionFiles, parseSessionFile } from './lib/session-audit/session-jsonl-parser.mjs';
import { summarize } from './lib/session-audit/call-stats.mjs';
import { redactText } from './lib/redact-secrets.mjs';

function parseArgs(argv) {
  const out = { sessions: false, days: 30, root: null, toolPrefix: 'hermit_', out: null, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sessions') out.sessions = true;
    else if (a === '--days') out.days = Number(argv[++i]) || 30;
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--tool-prefix') out.toolPrefix = argv[++i];
    else if (a === '--all-tools') out.toolPrefix = '';
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]) || 0;
  }
  return out;
}

/** Default transcript locations, in priority order. */
function defaultRoots() {
  return [
    join(homedir(), '.codex', 'sessions'),
    join(homedir(), '.claude', 'projects'),
  ].filter(existsSync);
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function pct(n) {
  return `${(n * 100).toFixed(2)}%`;
}

function buildReport(stats, meta) {
  const lines = [];
  lines.push('# Hermit Doctor — Session Audit', '');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Transcript roots: ${meta.roots.join(', ') || '(none found)'}`);
  lines.push(`- Files scanned: ${meta.filesScanned} (last ${meta.days} days)`);
  lines.push(`- Unparseable lines skipped: ${meta.badLines}`);
  lines.push(`- Tool filter: ${meta.toolPrefix ? `${meta.toolPrefix}*` : '(all tools)'}`);
  lines.push('');
  lines.push('## Summary', '');
  lines.push(`- Calls (deduped by call_id): **${stats.totalCalls}** (${stats.duplicatesDropped} duplicates dropped from ${stats.rawCalls} raw)`);
  lines.push(`- Errors: **${stats.totalErrors}** (${pct(stats.errorRate)})`);
  lines.push('');

  lines.push('## Per tool', '');
  lines.push('| Tool | Calls | Errors | Error rate | mean | p50 | p95 | max | incomplete |');
  lines.push('|------|-------|--------|-----------|------|-----|-----|-----|-----------|');
  for (const t of stats.perTool) {
    lines.push(`| ${t.tool} | ${t.total} | ${t.errors} | ${pct(t.errorRate)} | ${fmtMs(t.meanMs)} | ${fmtMs(t.p50Ms)} | ${fmtMs(t.p95Ms)} | ${fmtMs(t.maxMs)} | ${t.incomplete} |`);
  }
  lines.push('');

  lines.push('## Error fingerprints', '');
  if (!stats.fingerprints.length) {
    lines.push('None.');
  } else {
    lines.push('| Count | Tools | First seen | Last seen | Fingerprint |');
    lines.push('|-------|-------|-----------|-----------|-------------|');
    for (const f of stats.fingerprints.slice(0, 25)) {
      // Defence in depth: fingerprints are already redacted upstream.
      const fp = redactText(f.fingerprint).replace(/\|/g, '\\|');
      lines.push(`| ${f.count} | ${f.tools.join(', ')} | ${f.firstSeen || '—'} | ${f.lastSeen || '—'} | \`${fp}\` |`);
    }
  }
  lines.push('');
  lines.push('> Transcript content is secret-redacted before it reaches this report.');
  lines.push('> Reports are local only — never commit or upload them.');
  return lines.join('\n');
}

// ── CLI ──
const args = parseArgs(process.argv.slice(2));

if (!args.sessions) {
  console.error('Usage: node scripts/hermit-doctor.mjs --sessions [--days N] [--root DIR] [--tool-prefix hermit_] [--all-tools] [--out FILE]');
  process.exit(1);
}

const roots = args.root ? [args.root] : defaultRoots();
if (!roots.length) {
  console.error('No session transcript directory found. Pass --root DIR.');
  process.exit(1);
}

let files = [];
for (const root of roots) files.push(...collectSessionFiles(root, { days: args.days }));
if (args.limit) files = files.slice(0, args.limit);

const allCalls = [];
let badLines = 0;
for (const f of files) {
  const { calls, badLines: bad } = parseSessionFile(f, { toolPrefix: args.toolPrefix || undefined });
  allCalls.push(...calls);
  badLines += bad;
}

const stats = summarize(allCalls);
const report = buildReport(stats, {
  roots, filesScanned: files.length, badLines, days: args.days, toolPrefix: args.toolPrefix,
});

if (args.out) {
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, report, 'utf-8');
  console.log(`Report written: ${args.out}`);
  console.log(`${stats.totalCalls} calls, ${stats.totalErrors} errors (${pct(stats.errorRate)})`);
} else {
  console.log(report);
}
