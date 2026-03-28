#!/usr/bin/env node
// Launcher for better-memory-mcp with Python PATH fix for semantic search.
// No protocol translation — both Claude Code and the server use NDJSON.
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync, readdirSync } from 'fs';

// Fix PATH so python3.exe resolves (not Windows Store alias)
const PYTHON_DIR = String.raw`C:\Users\duy.lq\AppData\Local\Programs\Python\Python313`;
process.env.PATH = [PYTHON_DIR, `${PYTHON_DIR}\\Scripts`, process.env.PATH].join(';');

// Find cached better-memory-mcp entry point
const npxBase = join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
let serverEntry = '';
if (existsSync(npxBase)) {
  for (const dir of readdirSync(npxBase)) {
    const candidate = join(npxBase, dir, 'node_modules', '@sockeye44', 'better-memory-mcp', 'dist', 'index.js');
    if (existsSync(candidate)) {
      serverEntry = candidate;
      break;
    }
  }
}

if (!serverEntry) {
  process.stderr.write('Error: better-memory-mcp not found in npx cache\n');
  process.exit(1);
}

// Spawn server with inherited stdio — no proxy needed
const child = spawn('node', [serverEntry], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code || 0));
child.on('error', (err) => {
  process.stderr.write(`Launcher error: ${err.message}\n`);
  process.exit(1);
});
