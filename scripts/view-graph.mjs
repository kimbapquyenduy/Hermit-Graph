#!/usr/bin/env node
/**
 * hermit view — Opens the knowledge graph viewer in the default browser.
 *
 * Reads brain.jsonl, embeds data into the viewer HTML template,
 * writes a self-contained temp file, and opens it. No server needed.
 *
 * Usage:
 *   hermit view                     # auto-detect brain.jsonl
 *   hermit view path/to/brain.jsonl # specific file
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Resolve brain.jsonl path: CLI arg > env > default
const dataPath = process.argv[2]
  || process.env.MEMORY_FILE_PATH
  || join(ROOT, 'data', 'brain.jsonl');

const viewerTemplate = join(ROOT, 'viewer', 'index.html');

// Read files
let jsonlData;
try {
  jsonlData = readFileSync(resolve(dataPath), 'utf8');
} catch (err) {
  console.error(`Cannot read data file: ${dataPath}`);
  console.error(err.message);
  process.exit(1);
}

let html;
try {
  html = readFileSync(viewerTemplate, 'utf8');
} catch (err) {
  console.error(`Cannot read viewer template: ${viewerTemplate}`);
  console.error(err.message);
  process.exit(1);
}

// Count entities for status message
const entityCount = (jsonlData.match(/"type"\s*:\s*"entity"/g) || []).length;
const relationCount = (jsonlData.match(/"type"\s*:\s*"relation"/g) || []).length;

// Inject JSONL data into HTML — replace the empty-state section with auto-load script
const autoLoadScript = `
<script>
  // Auto-injected by 'hermit view' — data embedded, no file picker needed
  window.__HERMIT_DATA__ = ${JSON.stringify(jsonlData)};
  window.addEventListener('DOMContentLoaded', () => {
    // Hide file input controls since data is pre-loaded
    const loadBtn = document.querySelector('.btn-primary');
    if (loadBtn) loadBtn.style.display = 'none';
    // Auto-load the embedded data
    if (typeof loadBrainData === 'function') {
      loadBrainData(window.__HERMIT_DATA__);
    }
  });
</script>
`;

// Insert auto-load script before </body>
const output = html.replace('</body>', `${autoLoadScript}\n</body>`);

// Write to temp file
const tmpDir = join(tmpdir(), 'hermit-graph');
mkdirSync(tmpDir, { recursive: true });
const tmpFile = join(tmpDir, 'viewer.html');
writeFileSync(tmpFile, output, 'utf8');

console.log(`Hermit Graph Viewer`);
console.log(`  Data: ${resolve(dataPath)}`);
console.log(`  Entities: ${entityCount} | Relations: ${relationCount}`);
console.log(`  Opening: ${tmpFile}`);

// Open in default browser (cross-platform)
const platform = process.platform;
try {
  if (platform === 'win32') {
    execSync(`start "" "${tmpFile}"`, { shell: true, stdio: 'ignore' });
  } else if (platform === 'darwin') {
    execSync(`open "${tmpFile}"`, { stdio: 'ignore' });
  } else {
    execSync(`xdg-open "${tmpFile}"`, { stdio: 'ignore' });
  }
} catch {
  console.log(`\nCould not auto-open browser. Open manually:\n  file://${tmpFile}`);
}
