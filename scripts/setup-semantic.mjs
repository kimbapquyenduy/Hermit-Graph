#!/usr/bin/env node
/**
 * Setup script for semantic search (JS-native, no Python).
 * Verifies Node.js 18+, @huggingface/transformers installed,
 * downloads embedding model on first run.
 *
 * Usage: node scripts/setup-semantic.mjs
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// This is the explicit install path. Normal Hermit runtime never downloads.
process.env.HERMIT_ALLOW_MODEL_DOWNLOAD = '1';

console.log('=== Semantic Search Setup (JS-native) ===\n');

// 1. Check Node.js version
const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
if (nodeVersion < 18) {
  console.log(`❌ Node.js ${process.versions.node} detected. Requires Node.js 18+`);
  process.exit(1);
}
console.log(`✅ Node.js ${process.versions.node}`);

// 2. Check @huggingface/transformers
try {
  await import('@huggingface/transformers');
  console.log('✅ @huggingface/transformers installed');
} catch {
  console.log('❌ @huggingface/transformers not found');
  console.log('   Run: npm install @huggingface/transformers');
  process.exit(1);
}

// 3. Download model (first run)
console.log('\nDownloading embedding model (first time only, ~23MB)...');
try {
  const { isAvailable, MODEL_ID } = await import('./lib/embedding-service.mjs');
  const available = await isAvailable();
  if (available) {
    console.log(`✅ Model loaded: ${MODEL_ID}`);
  } else {
    console.log('❌ Model failed to load. Check error above.');
    process.exit(1);
  }
} catch (err) {
  console.log(`❌ Model load error: ${err.message}`);
  process.exit(1);
}

// 4. Check brain.jsonl
const brainPath = join(PROJECT_ROOT, 'data', 'brain.jsonl');
if (existsSync(brainPath)) {
  console.log('✅ brain.jsonl found');
} else {
  console.log('⚠️  brain.jsonl not found — embedding index cannot be built yet');
}

// 5. Check embedding index
const indexPath = join(PROJECT_ROOT, 'data', 'brain-embeddings.json');
if (existsSync(indexPath)) {
  console.log('✅ Embedding index exists');
} else {
  console.log('ℹ️  No embedding index yet. Run: npm run build:index');
}

console.log('\n=== Setup Complete ===');
console.log('Next steps:');
console.log('  npm run build:index   — Build embedding index from brain.jsonl');
console.log('  npm run search        — Search the knowledge graph');
