#!/usr/bin/env node
/** Exact model-cache validation: partial/sentinel caches are not installed. */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasLocalModelCache, MODEL_ID } from '../scripts/lib/embedding-service.mjs';

const root = mkdtempSync(join(process.cwd(), 'tmp', 'hermit-model-cache-'));
const modelRoot = join(root, ...MODEL_ID.split('/'));
try {
  mkdirSync(join(modelRoot, 'onnx'), { recursive: true });
  assert.equal(hasLocalModelCache(root), false, 'empty/partial cache must be rejected');
  writeFileSync(join(modelRoot, 'config.json'), '{}');
  writeFileSync(join(modelRoot, 'tokenizer.json'), '{}');
  writeFileSync(join(modelRoot, 'onnx', 'model.onnx'), 'fixture');
  assert.equal(hasLocalModelCache(root), true, 'complete local artifact set must be accepted');
  console.log('ok exact model cache validation');
} finally {
  rmSync(root, { recursive: true, force: true });
}
