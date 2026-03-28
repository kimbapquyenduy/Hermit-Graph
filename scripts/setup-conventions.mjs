/**
 * Setup script for auto-learn conventions via enhanced-mcp-memory.
 * Checks uv/pip availability and creates data directory.
 *
 * Usage: node scripts/setup-conventions.mjs
 */

import { execSync } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}

console.log('=== Auto-Learn Conventions Setup (enhanced-mcp-memory) ===\n');

// 1. Check uv (preferred) or pip
const uv = run('uv --version');
const pip = run('pip3 --version') || run('pip --version');

if (uv) {
  console.log('✅ uv ' + uv);
  console.log('   Install: uvx enhanced-mcp-memory');
} else if (pip) {
  console.log('✅ pip available (uv not found, using pip fallback)');
  console.log('   Install: pip install enhanced-mcp-memory');
  console.log('   Tip: Install uv for faster setup: https://docs.astral.sh/uv/');
} else {
  console.log('❌ Neither uv nor pip found.');
  console.log('   Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh');
  console.log('   Or install pip: python -m ensurepip --upgrade');
  process.exit(1);
}

// 2. Create conventions data directory
const dataDir = join(process.cwd(), 'data', 'conventions');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  console.log('✅ Created', dataDir);
} else {
  console.log('✅ Data directory exists:', dataDir);
}

// 3. Check enhanced-mcp-memory
const emm = run('uvx enhanced-mcp-memory --help 2>/dev/null') ||
             run('python -m enhanced_mcp_memory --help 2>/dev/null');
if (emm) {
  console.log('✅ enhanced-mcp-memory available');
} else {
  console.log('ℹ️  enhanced-mcp-memory will be auto-installed on first use via uvx');
}

console.log('\n=== Setup Complete ===');
console.log('Add "conventions" MCP server to .claude-settings.json.');
console.log('See docs/auto-learn-setup.md for full configuration.');
