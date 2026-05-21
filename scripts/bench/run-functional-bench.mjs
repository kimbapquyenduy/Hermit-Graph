#!/usr/bin/env node
/**
 * Functional e2e bench — does hermit actually make Claude Code BETTER?
 *
 * Each task simulates a realistic developer scenario. We capture:
 *   - The OPTIMAL hermit tool (predicted from descriptions + instructions)
 *   - The actual MCP response when that tool is called
 *   - An estimated "raw-grep alternative" cost (how many grep/read calls a
 *     hermit-less agent would need to answer the same question)
 *   - Actionability verdict — can an agent act on this response without
 *     follow-up exploration?
 *
 * Usage: node run-functional-bench.mjs
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const PROJECT = process.env.HERMIT_BENCH_PROJECT || process.argv.slice(2).find(a => !a.startsWith("--") && !/^(baseline|after|post|run-d|hard-)/.test(a)) || join(__dirname, "..", "..");
const SERVER = join(REPO_ROOT, 'scripts', 'hermit-mcp-server.mjs');
const OUT = join(__dirname, `functional-${new Date().toISOString().slice(0, 10)}.json`);

class McpClient {
  constructor(serverPath) {
    this.proc = spawn('node', [serverPath], {
      cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HERMIT_RETRIEVAL: 'bm25' },
    });
    this.buf = ''; this.nextId = 1; this.pending = new Map();
    this.proc.stdout.on('data', (c) => this._on(c));
    this.proc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  }
  _on(c) {
    this.buf += c.toString();
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      try {
        const m = JSON.parse(line);
        if (m.id != null && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      } catch {}
    }
  }
  request(method, params, timeoutMs = 60_000) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`Timeout ${method}`)); }, timeoutMs);
      this.pending.set(id, m => { clearTimeout(t); m.error ? rej(new Error(m.error.message)) : res(m.result); });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  notify(method, params) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  close() { this.proc.stdin.end(); }
}

const estTokens = (s) => Math.ceil(s.length / 4);

// Realistic developer scenarios. Each has:
//   intent: the natural-language task an agent would receive
//   optimal_tool: which hermit tool best answers it (from descriptions)
//   args: tool args
//   grep_alt_steps: estimated raw-grep+read step count without hermit
//   actionability_check: function(text) → { actionable: bool, why: string }
const SCENARIOS = [
  {
    intent: 'I want to understand how authentication works in this codebase',
    optimal_tool: 'hermit_query',
    args: { query: 'authentication session token check', cwd: PROJECT },
    grep_alt_steps: 6, // grep "auth" → list ~50 files → read 5-6 top candidates
    actionability_check: (text) => {
      const hasAuthSymbols = /auth|session|token/i.test(text);
      const hasFileLocs = /src\/.*\.(ts|tsx|js)/.test(text);
      return {
        actionable: hasAuthSymbols && hasFileLocs,
        why: hasAuthSymbols && hasFileLocs
          ? 'Returns auth symbols + file locations agent can open directly'
          : 'Missing symbol names or file locations',
      };
    },
  },
  {
    intent: "I'm about to rename getServerSession. What breaks?",
    optimal_tool: 'hermit_impact',
    args: { target: 'getServerSession', direction: 'upstream', cwd: PROJECT },
    grep_alt_steps: 15, // grep "getServerSession" → 197 hits → read every file? infeasible
    actionability_check: (text) => {
      const hasRiskLevel = /risk=(HIGH|MEDIUM|LOW)/i.test(text);
      const hasCallerCount = /d1=\d+/.test(text);
      const hasD1Names = /## d=1/.test(text);
      return {
        actionable: hasRiskLevel && hasCallerCount && hasD1Names,
        why: hasRiskLevel && hasCallerCount
          ? 'Risk level + d=1 names ready to act on'
          : 'Missing risk level or caller list',
      };
    },
  },
  {
    intent: 'How is PayOSClient used and what methods does it have?',
    optimal_tool: 'hermit_context',
    args: { name: 'PayOSClient', cwd: PROJECT },
    grep_alt_steps: 4, // read class file + grep "new PayOSClient" + read 2-3 callers
    actionability_check: (text) => {
      const hasMembers = /## Members/i.test(text);
      const hasMethodNames = /method:/i.test(text);
      const hasDrillDown = /Drill into/i.test(text);
      return {
        actionable: hasMembers && hasMethodNames,
        why: hasMembers && hasMethodNames
          ? `Member outline + drill-down hint — agent knows class shape immediately`
          : 'No member outline — agent must open the file',
      };
    },
  },
  {
    intent: 'What database transaction patterns do we use?',
    optimal_tool: 'hermit_query',
    args: { query: 'database transaction begin commit rollback', cwd: PROJECT },
    grep_alt_steps: 8, // grep "transaction"|"commit"|"rollback" across files
    actionability_check: (text) => {
      const hasTransactionSymbols = /transaction|rollback|commit/i.test(text);
      const filteredEmpty = /No high-confidence matches/i.test(text);
      const hasResults = /## Symbols/i.test(text);
      return {
        actionable: hasResults && hasTransactionSymbols,
        why: hasResults && hasTransactionSymbols
          ? 'Top-ranked transaction primitives surfaced'
          : filteredEmpty ? 'Filter killed valid results' : 'No transaction symbols found',
      };
    },
  },
  {
    intent: 'Find the cross-project memory about how we structure permissions',
    optimal_tool: 'hermit_unified_search',
    args: { query: 'permission role authorization check', cwd: PROJECT },
    grep_alt_steps: 10, // grep + read + agent re-explains across sessions
    actionability_check: (text) => {
      const hasCode = /CODE/.test(text);
      const hasKG = /KG/.test(text);
      return {
        actionable: hasCode || hasKG,
        why: (hasCode && hasKG)
          ? 'Both KG memory and code symbols returned — full picture'
          : hasCode ? 'Only code returned (no KG entries for this concept)'
          : hasKG ? 'Only KG returned' : 'No results',
      };
    },
  },
  {
    intent: 'Search for a nonsense concept — verify graceful handling',
    optimal_tool: 'hermit_query',
    args: { query: 'zzzbananaquantumflux nonexistent abc123', cwd: PROJECT },
    grep_alt_steps: 1, // grep returns instantly empty
    actionability_check: (text) => {
      const honestEmpty = /No (results|high-confidence matches)/i.test(text);
      const noMisleading = !/d1:|exp,/.test(text); // shouldn't return random symbols
      return {
        actionable: honestEmpty && noMisleading,
        why: honestEmpty && noMisleading
          ? 'Honest "no matches" — agent will refine query, not chase noise'
          : 'Returned misleading low-confidence dross',
      };
    },
  },
  {
    intent: 'Recall any past architectural decisions about token caching',
    optimal_tool: 'hermit_semantic_search',
    args: { query: 'token caching architecture decision' },
    grep_alt_steps: 5, // user has to re-explain past decisions
    actionability_check: (text) => {
      const hasEntities = /(BIZ:|TECH:|PATTERN:|DECISION:|INCIDENT:)/.test(text);
      const hasObservations = /\[\d+(\.\d+)?\|/.test(text); // confidence|date prefix
      return {
        actionable: hasEntities || hasObservations,
        why: hasEntities ? 'KG entities returned — no re-explanation needed'
          : 'No relevant memory found (acceptable if no decisions exist)',
      };
    },
  },
];

async function main() {
  process.stderr.write(`[functional] Starting against ${PROJECT}\n`);
  const cli = new McpClient(SERVER);
  const init = await cli.request('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'functional-bench', version: '1.0' },
  });
  cli.notify('notifications/initialized', {});
  const toolsResp = await cli.request('tools/list', {});
  const toolNames = (toolsResp.tools || []).map(t => t.name);

  // Verify all optimal tools are in CORE catalog (proves diet didn't hide critical tools).
  const missing = SCENARIOS.filter(s => !toolNames.includes(s.optimal_tool));
  if (missing.length) {
    process.stderr.write(`[functional] WARN: ${missing.length} optimal tools missing from catalog: ${missing.map(s => s.optimal_tool).join(', ')}\n`);
  } else {
    process.stderr.write(`[functional] ✓ All ${SCENARIOS.length} optimal tools present in 10-tool core catalog\n`);
  }

  // Warm index
  try { await cli.request('tools/call', { name: 'hermit_query', arguments: { query: 'warmup', cwd: PROJECT } }, 180_000); } catch {}

  const results = [];
  for (const sc of SCENARIOS) {
    process.stderr.write(`\n[functional] Intent: "${sc.intent}"\n`);
    process.stderr.write(`            Optimal tool: ${sc.optimal_tool}\n`);
    const start = Date.now();
    let resp, errMsg;
    try {
      resp = await cli.request('tools/call', { name: sc.optimal_tool, arguments: sc.args }, 60_000);
    } catch (e) { errMsg = e.message; }
    const ms = Date.now() - start;
    const text = errMsg ? `ERROR: ${errMsg}` : (resp?.content?.map(c => c.text || '').join('\n') || '');
    const check = sc.actionability_check(text);
    const row = {
      intent: sc.intent,
      optimal_tool: sc.optimal_tool,
      tool_in_core: toolNames.includes(sc.optimal_tool),
      args: sc.args,
      response_chars: text.length,
      response_est_tokens: estTokens(text),
      ms,
      grep_alt_steps: sc.grep_alt_steps,
      grep_alt_est_tokens: sc.grep_alt_steps * 800, // rough: ~800 tok per grep + read step
      actionable: check.actionable,
      verdict: check.why,
      response_preview: text.slice(0, 300),
      response_full: text,
    };
    results.push(row);
    process.stderr.write(`            Response: ${row.response_est_tokens} tokens, ${ms}ms\n`);
    process.stderr.write(`            Verdict:  ${check.actionable ? '✓ ACTIONABLE' : '✗ NOT-ACTIONABLE'} — ${check.why}\n`);
  }

  cli.close();

  const summary = {
    date: new Date().toISOString(),
    project: PROJECT,
    total_scenarios: results.length,
    actionable_count: results.filter(r => r.actionable).length,
    all_optimal_in_core: results.every(r => r.tool_in_core),
    hermit_total_tokens: results.reduce((a, r) => a + r.response_est_tokens, 0),
    grep_alt_total_tokens: results.reduce((a, r) => a + r.grep_alt_est_tokens, 0),
    hermit_total_ms: results.reduce((a, r) => a + r.ms, 0),
    avg_actionability_pct: Math.round(results.filter(r => r.actionable).length / results.length * 100),
  };

  writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2));

  process.stderr.write(`\n[functional] ─── SUMMARY ───\n`);
  process.stderr.write(`  Scenarios run        : ${summary.total_scenarios}\n`);
  process.stderr.write(`  Actionable responses : ${summary.actionable_count}/${summary.total_scenarios} (${summary.avg_actionability_pct}%)\n`);
  process.stderr.write(`  All optimal in core  : ${summary.all_optimal_in_core ? 'YES' : 'NO ⚠️'}\n`);
  process.stderr.write(`  Hermit total tokens  : ${summary.hermit_total_tokens}\n`);
  process.stderr.write(`  Grep-alt est tokens  : ${summary.grep_alt_total_tokens} (${Math.round((1 - summary.hermit_total_tokens / summary.grep_alt_total_tokens) * 100)}% less w/ hermit)\n`);
  process.stderr.write(`  Saved → ${OUT}\n`);
}

main().catch(err => { process.stderr.write(`FATAL: ${err.stack || err.message}\n`); process.exit(1); });
