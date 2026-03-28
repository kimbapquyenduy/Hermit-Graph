/**
 * Setup script for semantic search via better-memory-mcp.
 * Checks Python, pip, PyTorch availability.
 *
 * Usage: node scripts/setup-semantic.mjs
 */

import { execSync } from 'child_process';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}

console.log('=== Semantic Search Setup (better-memory-mcp) ===\n');

// 1. Check Python
const python = run('python3 --version') || run('python --version');
if (!python) {
  console.log('❌ Python not found. Install Python 3.8+ from https://python.org');
  console.log('   Windows: winget install Python.Python.3.12');
  process.exit(1);
}
console.log('✅ ' + python);

// 2. Check pip
const pip = run('pip3 --version') || run('pip --version');
if (!pip) {
  console.log('❌ pip not found. Run: python -m ensurepip --upgrade');
  process.exit(1);
}
console.log('✅ pip available');

// 3. Check PyTorch
const torch = run('python3 -c "import torch; print(torch.__version__)"') ||
              run('python -c "import torch; print(torch.__version__)"');
if (torch) {
  console.log('✅ PyTorch ' + torch);
} else {
  console.log('⚠️  PyTorch not installed. Install CPU-only version:');
  console.log('   pip install torch --index-url https://download.pytorch.org/whl/cpu');
  console.log('   (This is ~200MB download)\n');
  console.log('   After installing, run this script again.');
  process.exit(1);
}

// 4. Check better-memory-mcp
const bm = run('npx better-memory-mcp --version 2>/dev/null');
if (bm) {
  console.log('✅ better-memory-mcp available');
} else {
  console.log('ℹ️  better-memory-mcp will be auto-installed on first use via npx');
}

console.log('\n=== Setup Complete ===');
console.log('To enable semantic search, update .claude-settings.json:');
console.log('  Change: "@modelcontextprotocol/server-memory"');
console.log('  To:     "better-memory-mcp"');
console.log('\nFallback: If Python/PyTorch unavailable, keyword search still works.');
