#!/usr/bin/env node
/**
 * Token bench — measures Hermit MCP responses on a project corpus.
 *
 * Spawns hermit-mcp-server.mjs as subprocess, talks JSON-RPC over stdio
 * (same path agents use), captures wire-level response sizes for
 * before/after comparison.
 *
 * Usage:
 *   node run-token-bench.mjs [--label baseline|after] [--out FILE] [project-path]
 *   HERMIT_BENCH_PROJECT=/path/to/project node run-token-bench.mjs
 *
 * Default project: the repo itself (sanity check).
 * Saves JSON next to this script.
 */

import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const PROJECT = process.env.HERMIT_BENCH_PROJECT
  || process.argv.slice(2).find(a => !a.startsWith('--') && !/^(baseline|after|post|run-\d)/.test(a))
  || REPO_ROOT;
const SERVER = join(REPO_ROOT, 'scripts', 'hermit-mcp-server.mjs');

// ── CLI args ──
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}
const LABEL = arg('label', 'baseline');
const OUT_DIR = join(__dirname);
const OUT_FILE = arg('out', join(OUT_DIR, `${LABEL}-${new Date().toISOString().slice(0,10)}.json`));

// ── JSON-RPC stdio client ──
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
    this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    this.proc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
    this.proc.on('exit', (code) => process.stderr.write(`[server] exited code=${code}\n`));
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
      } catch (e) {
        process.stderr.write(`[parse-err] ${e.message}: ${line.slice(0, 200)}\n`);
      }
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
  close() {
    this.proc.stdin.end();
  }
}

// ── Token estimation ──
// 4 chars/token is rough estimate; for JSON-heavy content closer to 3.5
function estTokens(s) {
  return Math.ceil(s.length / 4);
}

// ── Bench tasks ──
// Picked to mimic realistic agent workflows:
//   - 3 concept searches (hermit_query)
//   - 1 unified search (KG+code fusion)
//   - 1 context call (360 view of a symbol)
//   - 1 impact call (blast radius)
//   - 1 recall (KG memory)
//   - 1 detect_changes (freshness check)
const TASKS = [
  { tool: 'hermit_query', args: { query: 'authentication', cwd: PROJECT }, note: 'Concept search — auth' },
  { tool: 'hermit_query', args: { query: 'user profile', cwd: PROJECT }, note: 'Concept search — profile' },
  { tool: 'hermit_query', args: { query: 'api routes', cwd: PROJECT }, note: 'Concept search — routes' },
  { tool: 'hermit_unified_search', args: { query: 'login flow', cwd: PROJECT }, note: 'KG + code fusion' },
  { tool: 'hermit_context', args: { name: 'Button', cwd: PROJECT }, note: 'Symbol 360 view' },
  { tool: 'hermit_impact', args: { target: 'Button', direction: 'upstream', cwd: PROJECT }, note: 'Blast radius' },
  { tool: 'hermit_semantic_search', args: { query: 'tech stack and architecture' }, note: 'Brain semantic recall' },
  { tool: 'hermit_detect_changes', args: { cwd: PROJECT }, note: 'Index freshness' },
];

// ── Main ──
async function main() {
  process.stderr.write(`[bench] Project: ${PROJECT}\n`);
  process.stderr.write(`[bench] Server: ${SERVER}\n`);
  process.stderr.write(`[bench] Label: ${LABEL}\n\n`);

  const cli = new McpClient(SERVER);

  // Handshake
  process.stderr.write('[bench] initialize...\n');
  const init = await cli.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'token-bench', version: '1.0.0' },
  });
  cli.notify('notifications/initialized', {});
  process.stderr.write(`[bench] server: ${init.serverInfo?.name} v${init.serverInfo?.version}\n`);

  // Catalog
  process.stderr.write('[bench] tools/list...\n');
  const toolsResp = await cli.request('tools/list', {});
  const tools = toolsResp.tools || [];
  const catalogJson = JSON.stringify(tools);
  process.stderr.write(`[bench] catalog: ${tools.length} tools, ${catalogJson.length} chars (~${estTokens(catalogJson)} tokens)\n`);

  // Warm index — first hermit_query on PROJECT triggers full index. Not part of bench.
  process.stderr.write('[bench] warming index (may take 30-60s on first run)...\n');
  const warmStart = Date.now();
  try {
    await cli.request('tools/call', {
      name: 'hermit_query',
      arguments: { query: 'warmup', cwd: PROJECT },
    }, 180_000);
    process.stderr.write(`[bench] warm done in ${Date.now() - warmStart}ms\n\n`);
  } catch (e) {
    process.stderr.write(`[bench] warmup failed: ${e.message} — continuing anyway\n\n`);
  }

  // Run tasks
  const results = [];
  for (const t of TASKS) {
    process.stderr.write(`[bench] ${t.tool} (${t.note})...\n`);
    const start = Date.now();
    let resp, errMsg;
    try {
      resp = await cli.request('tools/call', { name: t.tool, arguments: t.args }, 60_000);
    } catch (e) {
      errMsg = e.message;
    }
    const ms = Date.now() - start;

    let text = '';
    let isError = false;
    if (errMsg) {
      text = `ERROR: ${errMsg}`;
      isError = true;
    } else {
      text = resp?.content?.map(c => c.text || '').join('\n') || '';
      isError = !!resp?.isError;
    }

    const row = {
      tool: t.tool,
      note: t.note,
      args: t.args,
      ms,
      chars: text.length,
      est_tokens: estTokens(text),
      isError,
      preview: text.slice(0, 240),
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

  const baseline = {
    label: LABEL,
    date: new Date().toISOString(),
    project: PROJECT,
    project_path: PROJECT,
    server_info: init.serverInfo,
    catalog: {
      tool_count: tools.length,
      bytes: catalogJson.length,
      est_tokens: estTokens(catalogJson),
      tool_names: tools.map(t => t.name),
    },
    tasks: results,
    totals,
  };

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(baseline, null, 2));

  process.stderr.write(`\n[bench] ─── SUMMARY (${LABEL}) ───\n`);
  process.stderr.write(`  Tool catalog : ${tools.length} tools, ~${estTokens(catalogJson)} tokens\n`);
  process.stderr.write(`  Tasks run    : ${totals.task_count} (errors: ${totals.errors})\n`);
  process.stderr.write(`  Response sum : ${totals.response_chars} chars (~${totals.response_est_tokens} tokens)\n`);
  process.stderr.write(`  Total time   : ${totals.total_ms}ms\n`);
  process.stderr.write(`  Per-task avg : ${Math.round(totals.response_est_tokens / totals.task_count)} tokens, ${Math.round(totals.total_ms / totals.task_count)}ms\n`);
  process.stderr.write(`\n[bench] saved → ${OUT_FILE}\n`);
}

main().catch(err => {
  process.stderr.write(`[bench] FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
