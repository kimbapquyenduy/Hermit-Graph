#!/usr/bin/env node
/**
 * hermit view — Opens the knowledge graph or code graph viewer in the default browser.
 *
 * Reads JSONL data, embeds it into the viewer HTML template,
 * writes a self-contained temp file, and opens it. No server needed.
 *
 * Usage:
 *   hermit view                     # KG viewer with auto-detect brain.jsonl
 *   hermit view path/to/brain.jsonl # KG viewer with specific file
 *   hermit view --code              # CodeGraph viewer with auto-detect code-symbols.jsonl
 *   hermit view --code path/to/code-symbols.jsonl  # CodeGraph viewer with specific file
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Detect --code flag
const args = process.argv.slice(2);
const codeMode = args.includes('--code');
const filteredArgs = args.filter(a => a !== '--code');

if (codeMode) {
  launchCodeViewer(filteredArgs[0]);
} else {
  launchKGViewer(filteredArgs[0]);
}

// ── KG Viewer ──
// Data priority: explicit arg → MEMORY_FILE_PATH env → <cwd>/data/brain.jsonl → empty (no data).
// Viewer renders empty state when no data found — user can still load a file via the UI.
function launchKGViewer(dataArg) {
  const cwd = process.cwd();
  const candidate = dataArg
    ? resolve(dataArg)
    : (process.env.MEMORY_FILE_PATH || join(cwd, 'data', 'brain.jsonl'));

  const viewerTemplate = join(ROOT, 'viewer', 'index.html');
  const html = readFileSafe(viewerTemplate, 'viewer template');

  const hasData = existsSync(candidate);
  const jsonlData = hasData ? readFileSync(candidate, 'utf8') : '';
  const entityCount = hasData ? (jsonlData.match(/"type"\s*:\s*"entity"/g) || []).length : 0;
  const relationCount = hasData ? (jsonlData.match(/"type"\s*:\s*"relation"/g) || []).length : 0;

  const autoLoadScript = hasData ? `
<script>
  window.__HERMIT_DATA__ = ${JSON.stringify(jsonlData)};
  window.addEventListener('DOMContentLoaded', () => {
    const loadBtn = document.querySelector('.btn-primary');
    if (loadBtn) loadBtn.style.display = 'none';
    if (typeof loadBrainData === 'function') {
      loadBrainData(window.__HERMIT_DATA__);
    }
  });
</script>
` : '';

  const output = html.replace('</body>', `${autoLoadScript}\n</body>`);
  const tmpFile = writeTempFile('viewer.html', output);

  console.log(`Hermit Graph Viewer (Knowledge Graph)`);
  console.log(`  Project CWD: ${cwd}`);
  if (hasData) {
    console.log(`  Data: ${candidate}`);
    console.log(`  Entities: ${entityCount} | Relations: ${relationCount}`);
  } else {
    console.log(`  Data: (none — no brain.jsonl at ${candidate})`);
    console.log(`  Viewer will open empty. Use the UI to load a file.`);
  }
  console.log(`  Opening: ${tmpFile}`);

  openInBrowser(tmpFile);
}

// ── CodeGraph Viewer ──
// Data priority: explicit arg → <cwd>/data/code-symbols.jsonl → empty (no data).
// Viewer opens empty when no code graph is indexed for the current project.
function launchCodeViewer(dataArg) {
  const cwd = process.cwd();
  const candidate = dataArg
    ? resolve(dataArg)
    : join(cwd, 'data', 'code-symbols.jsonl');
  const brainPath = process.env.MEMORY_FILE_PATH || join(cwd, 'data', 'brain.jsonl');
  const viewerTemplate = join(ROOT, 'viewer', 'code-viewer.html');

  const html = readFileSafe(viewerTemplate, 'viewer template');

  const hasData = existsSync(candidate);
  const jsonlData = hasData ? readFileSync(candidate, 'utf8') : '';

  let brainData = null;
  let brainStats = '';
  if (existsSync(brainPath)) {
    try {
      brainData = readFileSync(brainPath, 'utf8');
      const ruleCount = (brainData.match(/"entityType"\s*:\s*"biz-rule"/g) || []).length;
      const flowCount = (brainData.match(/"entityType"\s*:\s*"biz-flow"/g) || []).length;
      brainStats = `  Brain: ${brainPath} (${ruleCount} rules, ${flowCount} flows)`;
    } catch { /* skip */ }
  }

  const symbolCount = hasData ? (jsonlData.match(/"_type"\s*:\s*"symbol"/g) || []).length : 0;
  const relationCount = hasData ? (jsonlData.match(/"_type"\s*:\s*"relation"/g) || []).length : 0;

  const autoLoadScript = hasData ? `
<script>
  window.__HERMIT_CODE_DATA__ = ${JSON.stringify(jsonlData)};
  ${brainData ? `window.__HERMIT_BRAIN_DATA__ = ${JSON.stringify(brainData)};` : ''}
  if (typeof loadCodeData === 'function') {
    loadCodeData(window.__HERMIT_CODE_DATA__);
  }
</script>
` : '';

  const output = html.replace('</body>', `${autoLoadScript}\n</body>`);
  const tmpFile = writeTempFile('code-viewer.html', output);

  console.log(`Hermit Graph Viewer (CodeGraph)`);
  console.log(`  Project CWD: ${cwd}`);
  if (hasData) {
    console.log(`  Data: ${candidate}`);
    console.log(`  Symbols: ${symbolCount} | Relations: ${relationCount}`);
  } else {
    console.log(`  Data: (none — no code-symbols.jsonl at ${candidate})`);
    console.log(`  Run 'hermit index' to generate one for this project, or open a project that has it.`);
  }
  if (brainStats) console.log(brainStats);
  console.log(`  Opening: ${tmpFile}`);

  openInBrowser(tmpFile);
}

// ── Helpers ──
function readFileSafe(filePath, label) {
  try {
    return readFileSync(resolve(filePath), 'utf8');
  } catch (err) {
    console.error(`Cannot read ${label}: ${filePath}`);
    console.error(err.message);
    process.exit(1);
  }
}

function writeTempFile(filename, content) {
  const tmpDir = join(tmpdir(), 'hermit-graph');
  mkdirSync(tmpDir, { recursive: true });
  const tmpFile = join(tmpDir, filename);
  writeFileSync(tmpFile, content, 'utf8');
  return tmpFile;
}

function openInBrowser(filePath) {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      execSync(`start "" "${filePath}"`, { shell: true, stdio: 'ignore' });
    } else if (platform === 'darwin') {
      execSync(`open "${filePath}"`, { stdio: 'ignore' });
    } else {
      execSync(`xdg-open "${filePath}"`, { stdio: 'ignore' });
    }
  } catch {
    console.log(`\nCould not auto-open browser. Open manually:\n  file://${filePath}`);
  }
}
