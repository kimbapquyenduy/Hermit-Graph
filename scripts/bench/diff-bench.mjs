#!/usr/bin/env node
/**
 * Diff two token-bench runs side by side.
 *
 * Usage:
 *   node diff-bench.mjs <baseline.json> <after.json>
 */

import { readFileSync } from 'fs';

const [_a, _b, baselinePath, afterPath] = process.argv;
if (!baselinePath || !afterPath) {
  console.error('Usage: node diff-bench.mjs <baseline.json> <after.json>');
  process.exit(2);
}

const a = JSON.parse(readFileSync(baselinePath, 'utf-8'));
const b = JSON.parse(readFileSync(afterPath, 'utf-8'));

function pct(before, after) {
  if (before === 0) return after === 0 ? '  0.0%' : ' +inf';
  const d = (after - before) / before * 100;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}%`;
}

function fmt(n) { return String(n).padStart(7); }

console.log(`\n═══ Token Diet Diff: ${a.label} → ${b.label} ═══\n`);
console.log(`Project: ${a.project}\n`);

console.log('─── Tool Catalog ───');
console.log(`  Tool count   ${fmt(a.catalog.tool_count)} → ${fmt(b.catalog.tool_count)}   (${pct(a.catalog.tool_count, b.catalog.tool_count)})`);
console.log(`  Catalog tok  ${fmt(a.catalog.est_tokens)} → ${fmt(b.catalog.est_tokens)}   (${pct(a.catalog.est_tokens, b.catalog.est_tokens)})\n`);

console.log('─── Per-task ───');
console.log('  Tool                              Before    After    Δ tokens     Δ ms');
console.log('  ' + '─'.repeat(78));
const aByKey = new Map(a.tasks.map(t => [`${t.tool}|${t.note}`, t]));
for (const tb of b.tasks) {
  const ta = aByKey.get(`${tb.tool}|${tb.note}`);
  if (!ta) {
    console.log(`  ${tb.tool.padEnd(33)} (new)`);
    continue;
  }
  const tokDelta = pct(ta.est_tokens, tb.est_tokens);
  const msDelta = pct(ta.ms, tb.ms);
  const label = `${tb.tool} (${tb.note})`.slice(0, 33).padEnd(33);
  console.log(`  ${label} ${fmt(ta.est_tokens)} ${fmt(tb.est_tokens)}    ${tokDelta.padStart(7)}  ${msDelta.padStart(7)}`);
}

console.log('\n─── Totals ───');
const sessionA = a.catalog.est_tokens + a.totals.response_est_tokens;
const sessionB = b.catalog.est_tokens + b.totals.response_est_tokens;
console.log(`  Response sum (8 tasks)    ${fmt(a.totals.response_est_tokens)} → ${fmt(b.totals.response_est_tokens)}   (${pct(a.totals.response_est_tokens, b.totals.response_est_tokens)})`);
console.log(`  Session total (cat+resp)  ${fmt(sessionA)} → ${fmt(sessionB)}   (${pct(sessionA, sessionB)})`);
console.log(`  Total time                ${fmt(a.totals.total_ms)} → ${fmt(b.totals.total_ms)}   (${pct(a.totals.total_ms, b.totals.total_ms)})`);
console.log(`  Errors                    ${fmt(a.totals.errors)} → ${fmt(b.totals.errors)}\n`);

// Verdict
const sessionDelta = (sessionB - sessionA) / sessionA;
if (sessionDelta <= -0.59) {
  console.log(`✅ TARGET HIT — session total reduced ≥ 59% (CodeGraph parity)`);
} else if (sessionDelta <= -0.40) {
  console.log(`🟡 PARTIAL — session reduced ≥ 40% but short of 59% target`);
} else if (sessionDelta < 0) {
  console.log(`🟠 SMALL WIN — session reduced by ${(-sessionDelta * 100).toFixed(1)}%`);
} else {
  console.log(`❌ REGRESSION — session grew by ${(sessionDelta * 100).toFixed(1)}%`);
}
console.log('');
