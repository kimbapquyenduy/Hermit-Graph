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

// ── Universal --help / --version detection ──
// Check BEFORE routing to any subcommand so flags are never treated as positional args.
// Also check `command` position — hermit --help and hermit health --help both work.
const allArgv = process.argv.slice(2);
const helpRequested = allArgv.includes('--help') || allArgv.includes('-h');
const versionRequested = allArgv.includes('--version') || allArgv.includes('-v');

const COMMANDS = {
  search: {
    desc: 'Hybrid semantic + keyword search',
    usage: 'hermit search <query>',
    examples: [
      'hermit search "payment gateway"',
      'hermit search "auth bug 2026"',
    ],
    run: runSearch,
  },
  skills: {
    desc: 'List, add, or remove AI agent skills',
    usage: 'hermit skills [list|add|remove|info|installed]',
    examples: [
      'hermit skills',
      'hermit skills add biz-guard',
      'hermit skills add --all',
    ],
    run: runSkills,
  },
  setup: {
    desc: 'Project setup — configures ALL agents by default (zero-config)',
    usage: 'hermit setup [--agent <name|all>] [--mcp-only] [--only x,y] [--skip x,y]',
    examples: ['hermit setup', 'hermit setup --agent claude'],
    run: () => runScript('setup-project.mjs', args),
  },
  health: {
    desc: 'Run graph health checks',
    usage: 'hermit health',
    examples: ['hermit health'],
    run: () => runScript('brain-health.mjs'),
  },
  index: {
    desc: 'Build/rebuild embedding index',
    usage: 'hermit index [--force]',
    examples: ['hermit index', 'hermit index --force'],
    run: () => runScript('build-embedding-index.mjs', args),
  },
  export: {
    desc: 'Export SQLite brain.db to brain.jsonl',
    usage: 'hermit export [--db <path>] [--to <path>] [--verbose]',
    examples: ['hermit export', 'hermit export --to /tmp/backup.jsonl'],
    run: () => runScript('export-sqlite-to-jsonl.mjs', args),
  },
  stale: {
    desc: 'Stale observation report',
    usage: 'hermit stale',
    examples: ['hermit stale'],
    run: () => runScript('stale-report.mjs'),
  },
  serve: {
    desc: 'Start Hermit MCP server (unified)',
    usage: 'hermit serve',
    examples: ['hermit serve'],
    run: () => runScript('hermit-mcp-server.mjs'),
  },
  migrate: {
    desc: 'Migrate brain.jsonl from v3 to v4 format',
    usage: 'hermit migrate [path] [--yes]',
    examples: ['hermit migrate', 'hermit migrate /path/to/brain.jsonl --yes'],
    run: () => runScript('migrate-v3-to-v4.mjs', args),
  },
  view: {
    desc: 'Open dashboard viewer (--code for CodeGraph)',
    usage: 'hermit view [--code] [path]',
    examples: ['hermit view', 'hermit view --code'],
    run: runView,
  },
  'check-edit': {
    desc: 'Pre-edit impact check for source file(s)',
    usage: 'hermit check-edit <file>... [--verbose] [--format=json] [--cwd=PATH]',
    examples: ['hermit check-edit src/api/routes.ts'],
    run: () => runScript('check-edit-cli.mjs', args),
  },
  help: {
    desc: 'Show this help',
    usage: 'hermit help',
    examples: ['hermit help'],
    run: showHelp,
  },
};

// ── Help printer ──

/**
 * Print help for a specific command or global help.
 * @param {string|null} cmdName
 */
function printHelp(cmdName) {
  if (cmdName && COMMANDS[cmdName]) {
    const cmd = COMMANDS[cmdName];
    console.log('');
    console.log(`  hermit ${cmdName} — ${cmd.desc}`);
    console.log('');
    console.log(`  Usage: ${cmd.usage}`);
    if (cmd.examples?.length) {
      console.log('');
      console.log('  Examples:');
      for (const ex of cmd.examples) console.log(`    ${ex}`);
    }
    console.log('');
  } else {
    showHelp();
  }
}

// ── Command runners ──

async function runSkills() {
  const { run } = await import('./skills-manager.mjs');
  await run(args);
}

async function runSearch() {
  const query = args.filter(a => !a.startsWith('-')).join(' ');
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
  // Preserve user's original cwd via env — some scripts (check-edit) need to
  // resolve against the caller's directory, not hermit-graph's install root.
  const env = { ...process.env, HERMIT_USER_CWD: process.cwd() };
  const child = fork(script, extraArgs, { cwd: ROOT, stdio: 'inherit', env });
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

// Handle --version / -v anywhere in argv
if (versionRequested) {
  console.log(`hermit-graph v${PKG_VERSION}`);
  process.exit(0);
}

// Handle --help / -h with no real command → global help
if (helpRequested && (!command || command === '--help' || command === '-h')) {
  showHelp();
  process.exit(0);
}

if (!command || !COMMANDS[command]) {
  // Edge case: command IS the help flag (hermit --help handled above, but guard anyway)
  if (!command || command.startsWith('-')) { showHelp(); process.exit(0); }
  console.error(`Unknown command: ${command}\n`);
  showHelp();
  process.exit(1);
}

// Handle --help / -h for a specific command: print its help, never run
if (helpRequested) {
  printHelp(command);
  process.exit(0);
}

try {
  await COMMANDS[command].run();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
