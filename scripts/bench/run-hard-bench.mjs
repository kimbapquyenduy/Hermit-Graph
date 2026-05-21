#!/usr/bin/env node
/**
 * HARD bench — stress test with complicated real-world tasks.
 *
 * Targets symbols with massive impact (getServerSession: 197 callers,
 * query: 125 callers) and complex containers (PayOSClient class).
 * Validates that token diet still produces USEFUL responses, not just
 * compact garbage.
 *
 * Usage: node run-hard-bench.mjs [--label hard-baseline|hard-after]
 *
 * Reuses the same JSON-RPC stdio harness as run-token-bench.mjs.
 */

import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const PROJECT = process.env.HERMIT_BENCH_PROJECT || process.argv.slice(2).find(a => !a.startsWith("--") && !/^(baseline|after|post|run-d|hard-)/.test(a)) || join(__dirname, "..", "..");
const SERVER = join(REPO_ROOT, 'scripts', 'hermit-mcp-server.mjs');

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}
const LABEL = arg('label', 'hard-baseline');
const OUT_FILE = join(__dirname, `${LABEL}-${new Date().toISOString().slice(0, 10)}.json`);

class McpClient {
  constructor(serverPath) {
    this.proc = spawn('node', [serverPath], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HERMIT_RETRIEVAL: 'bm25' },
    });
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    this.proc.stdout.on('data', (c) => this._onData(c));
    this.proc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  }
  _onData(chunk) {
    this.buf += chunk.toString();
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        }
      } catch {}
    }
  }
  request(method, params, timeoutMs = 120_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout ${method} after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  close() { this.proc.stdin.end(); }
}

const estTokens = (s) => Math.ceil(s.length / 4);

// HARD tasks — picked to stress different parts of the diet:
//   1-3: massive impact (high blast radius) — validates F9 counts-first
//   4:   class context — validates F4 container outline
//   5-6: nuanced semantic queries — validates symbol ranking under noise
//   7:   verbose mode opt-in — validates we don't break power-user flows
//   8:   query that returns nothing — validates empty-result handling
const TASKS = [
  { tool: 'hermit_impact', args: { target: 'getServerSession', direction: 'upstream', cwd: PROJECT }, note: 'Impact: getServerSession (197 callers)' },
  { tool: 'hermit_impact', args: { target: 'query', direction: 'upstream', cwd: PROJECT }, note: 'Impact: query (125 callers, DB layer)' },
  { tool: 'hermit_impact', args: { target: 'isClassOwner', direction: 'upstream', cwd: PROJECT }, note: 'Impact: isClassOwner (48 callers, permission)' },
  { tool: 'hermit_context', args: { name: 'PayOSClient', cwd: PROJECT }, note: 'Context: PayOSClient (class — tests F4 outline)' },
  { tool: 'hermit_query', args: { query: 'database transaction rollback', cwd: PROJECT }, note: 'Semantic: db transactions' },
  { tool: 'hermit_query', args: { query: 'role permission check before mutation', cwd: PROJECT }, note: 'Semantic: permissions' },
  { tool: 'hermit_impact', args: { target: 'getServerSession', direction: 'upstream', verbose: true, cwd: PROJECT }, note: 'Impact verbose (full d=2/d=3)' },
  { tool: 'hermit_query', args: { query: 'xyznonexistentsymbolquerythat-finds-nothing-zz', cwd: PROJECT }, note: 'Empty-result query' },
];

async function main() {
  process.stderr.write(`[hard-bench] Project: ${PROJECT}\n[hard-bench] Label: ${LABEL}\n\n`);

  const cli = new McpClient(SERVER);
  const init = await cli.request('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'hard-bench', version: '1.0' },
  });
  cli.notify('notifications/initialized', {});

  const toolsResp = await cli.request('tools/list', {});
  const tools = toolsResp.tools || [];
  const catalogJson = JSON.stringify(tools);
  process.stderr.write(`[hard-bench] catalog: ${tools.length} tools, ~${estTokens(catalogJson)} tokens\n`);

  // Warm
  try {
    await cli.request('tools/call', { name: 'hermit_query', arguments: { query: 'warmup', cwd: PROJECT } }, 180_000);
  } catch (e) { process.stderr.write(`[hard-bench] warmup: ${e.message}\n`); }

  const results = [];
  for (const t of TASKS) {
    process.stderr.write(`[hard-bench] ${t.tool} (${t.note})...\n`);
    const start = Date.now();
    let resp, errMsg;
    try {
      resp = await cli.request('tools/call', { name: t.tool, arguments: t.args }, 90_000);
    } catch (e) { errMsg = e.message; }
    const ms = Date.now() - start;
    let text = '', isError = false;
    if (errMsg) { text = `ERROR: ${errMsg}`; isError = true; }
    else { text = resp?.content?.map(c => c.text || '').join('\n') || ''; isError = !!resp?.isError; }
    const row = {
      tool: t.tool, note: t.note, args: t.args, ms,
      chars: text.length, est_tokens: estTokens(text), isError,
      // Save FULL text for hard tasks — we want to inspect quality, not just size.
      text,
    };
    results.push(row);
    process.stderr.write(`  → ${row.chars} chars (~${row.est_tokens} tokens), ${ms}ms${isError ? ' [ERROR]' : ''}\n`);
  }
  cli.close();

  const totals = {
    task_count: results.length,
    response_chars: results.reduce((a, r) => a + r.chars, 0),
    response_est_tokens: results.reduce((a, r) => a + r.est_tokens, 0),
    total_ms: results.reduce((a, r) => a + r.ms, 0),
    errors: results.filter(r => r.isError).length,
  };

  const out = {
    label: LABEL, date: new Date().toISOString(),
    project: PROJECT, project_path: PROJECT,
    server_info: init.serverInfo,
    catalog: { tool_count: tools.length, bytes: catalogJson.length, est_tokens: estTokens(catalogJson), tool_names: tools.map(t => t.name) },
    tasks: results, totals,
  };
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  process.stderr.write(`\n[hard-bench] ─── SUMMARY (${LABEL}) ───\n`);
  process.stderr.write(`  Catalog : ${tools.length} tools, ~${estTokens(catalogJson)} tokens\n`);
  process.stderr.write(`  Tasks   : ${totals.task_count} (errors: ${totals.errors})\n`);
  process.stderr.write(`  Response: ${totals.response_chars} chars (~${totals.response_est_tokens} tokens)\n`);
  process.stderr.write(`  Time    : ${totals.total_ms}ms\n`);
  process.stderr.write(`  Saved → ${OUT_FILE}\n`);
}

main().catch(err => { process.stderr.write(`[hard-bench] FATAL: ${err.stack || err.message}\n`); process.exit(1); });
