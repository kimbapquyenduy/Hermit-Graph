#!/usr/bin/env node
// Launcher for enhanced-mcp-memory conventions server.
// Auto-resolves DATA_DIR per project based on CWD if not explicitly set.
// No protocol translation — both Claude Code and the server use NDJSON.
import { spawn } from 'child_process';
import { join } from 'path';
import { mkdirSync } from 'fs';

const UVX_PATH = String.raw`C:\Users\duy.lq\AppData\Local\Programs\Python\Python313\Scripts\uvx.exe`;

// Auto-resolve DATA_DIR: use env if set, otherwise derive from CWD
if (!process.env.DATA_DIR) {
  // Store conventions data per-project under claude-code-brain/data/conventions/{project-name}
  const projectName = process.cwd().replace(/[\\/]/g, '_').replace(/^_+/, '').toLowerCase();
  const brainBase = String.raw`D:\Project\Personal Project\claude-code-brain\data\conventions`;
  process.env.DATA_DIR = join(brainBase, projectName);
}

// Ensure DATA_DIR exists
mkdirSync(process.env.DATA_DIR, { recursive: true });

const child = spawn(UVX_PATH, ['enhanced-mcp-memory'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code || 0));
child.on('error', (err) => {
  process.stderr.write(`Launcher error: ${err.message}\n`);
  process.exit(1);
});
