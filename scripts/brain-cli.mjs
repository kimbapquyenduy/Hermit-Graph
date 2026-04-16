#!/usr/bin/env node
/**
 * Hermit Graph CLI — single entry point for all graph operations.
 *
 * Usage: hermit <command> [args]
 *
 * Commands:
 *   skills           List, add, or remove AI agent skills
 *   setup            Full project setup (skills + commands + hooks)
 *   search <query>   Hybrid semantic + keyword search
 *   health           Run graph health checks
 *   index [--force]  Build/rebuild embedding index
 *   export           Export MCP DB to brain.jsonl
 *   stale            Stale observation report
 *   serve            Start MCP memory server
 *   view             Open dashboard viewer
 *   help             Show this help
 */

import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync, fork } from 'child_process';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

const [,, command, ...args] = process.argv;

const COMMANDS = {
  search: {
    desc: 'Hybrid semantic + keyword search',
    usage: 'hermit search <query>',
    run: runSearch,
  },
  skills: {
    desc: 'List, add, or remove AI agent skills',
    usage: 'hermit skills [list|add|remove|info|installed]',
    run: runSkills,
  },
  setup: {
    desc: 'Project setup — configures ALL agents by default (zero-config)',
    usage: 'hermit setup [--agent <name|all>] [--mcp-only] [--only x,y] [--skip x,y]',
    run: () => runScript('setup-project.mjs', args),
  },
  health: {
    desc: 'Run graph health checks',
    usage: 'hermit health',
    run: () => runScript('brain-health.mjs'),
  },
  index: {
    desc: 'Build/rebuild embedding index',
    usage: 'hermit index [--force]',
    run: () => runScript('build-embedding-index.mjs', args),
  },
  export: {
    desc: 'Export MCP DB to brain.jsonl',
    usage: 'hermit export',
    run: () => runScript('export-db-to-jsonl.mjs'),
  },
  stale: {
    desc: 'Stale observation report',
    usage: 'hermit stale',
    run: () => runScript('stale-report.mjs'),
  },
  serve: {
    desc: 'Start Hermit MCP server (unified)',
    usage: 'hermit serve',
    run: () => runScript('hermit-mcp-server.mjs'),
  },
  migrate: {
    desc: 'Migrate brain.jsonl from v3 to v4 format',
    usage: 'hermit migrate [path]',
    run: () => runScript('migrate-v3-to-v4.mjs', args),
  },
  view: {
    desc: 'Open dashboard viewer',
    usage: 'hermit view',
    run: runView,
  },
  help: {
    desc: 'Show this help',
    usage: 'hermit help',
    run: showHelp,
  },
};

// ── Command runners ──

async function runSkills() {
  const { run } = await import('./skills-manager.mjs');
  await run(args);
}

async function runSearch() {
  const query = args.join(' ');
  if (!query) {
    console.error('Usage: hermit search <query>');
    process.exit(1);
  }
  const { search, searchStatus } = await import('./lib/semantic-search.mjs');
  const status = searchStatus();
  const mode = status.vectorSearch ? 'hybrid (vector+keyword)' : 'keyword-only';
  console.log(`Search mode: ${mode} | Entities: ${status.indexEntityCount}`);
  console.log(`Query: "${query}"\n`);

  const results = await search(query, { topK: 10 });
  if (results.length === 0) {
    console.log('No results found.');
    return;
  }
  for (const r of results) {
    const score = r.score.toFixed(3);
    console.log(`  ${score}  ${r.name} (${r.entityType})`);
  }
  console.log(`\n${results.length} results`);
}

function runView() {
  const script = join(__dirname, 'view-graph.mjs');
  const child = fork(script, args, { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));
}

function runScript(name, extraArgs = []) {
  const script = join(__dirname, name);
  const child = fork(script, extraArgs, { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));
}

function showHelp() {
  console.log('');
  console.log(`  hermit — Hermit Graph CLI v${PKG_VERSION}`);
  console.log('');
  console.log('  Usage: hermit <command> [args]');
  console.log('');
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`    ${name.padEnd(10)} ${cmd.desc}`);
  }
  console.log('');
  console.log('  Examples:');
  console.log('    hermit skills                          List available skills');
  console.log('    hermit skills add biz-guard api-design  Install specific skills');
  console.log('    hermit skills add --all                 Install everything');
  console.log('    hermit search "payment integration"');
  console.log('    hermit health');
  console.log('    hermit index --force');
  console.log('');
}

// ── Main ──

if (!command || !COMMANDS[command]) {
  if (command) console.error(`Unknown command: ${command}\n`);
  showHelp();
  process.exit(command ? 1 : 0);
}

try {
  await COMMANDS[command].run();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
