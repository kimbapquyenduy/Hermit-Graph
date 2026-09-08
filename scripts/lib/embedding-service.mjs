/**
 * Singleton embedding service using @huggingface/transformers.
 * Loads all-MiniLM-L6-v2 ONNX model (~23MB) for 384-dim text embeddings.
 * No Python dependency — pure JS/WASM inference.
 *
 * Usage:
 *   import { embed, embedBatch, isAvailable } from './embedding-service.mjs';
 *   const vec = await embed("Hello world"); // Float32Array[384]
 */

import { pipeline, env } from '@huggingface/transformers';
import { join, dirname } from 'path';
import { existsSync, statSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// Cache model in data/.model-cache/ (gitignored via data/)
env.cacheDir = join(PROJECT_ROOT, 'data', '.model-cache');
// Only the explicit installer may resolve remote model files.
const ALLOW_MODEL_DOWNLOAD = process.env.HERMIT_ALLOW_MODEL_DOWNLOAD === '1';
env.allowRemoteModels = ALLOW_MODEL_DOWNLOAD;

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;
const MODEL_CACHE_ROOT = join(PROJECT_ROOT, 'data', '.model-cache');

/** Require the exact local artifacts needed by Transformers. */
export function hasLocalModelCache(cacheDir = MODEL_CACHE_ROOT) {
  const modelRoot = join(cacheDir, ...MODEL_ID.split('/'));
  const required = [
    join(modelRoot, 'config.json'),
    join(modelRoot, 'tokenizer.json'),
    join(modelRoot, 'onnx', 'model.onnx'),
  ];
  try {
    for (const file of required) {
      const stat = existsSync(file) ? statSync(file) : null;
      if (!stat?.isFile() || stat.size <= 0) return false;
    }
    const config = JSON.parse(readFileSync(required[0], 'utf8'));
    return !!config && typeof config === 'object' && !Array.isArray(config);
  } catch {
    return false;
  }
}

let _extractor = null;
let _loadError = null;
/** In-flight load, shared by all concurrent callers. See getExtractor(). */
let _loadPromise = null;

/** Give up on a model load that hangs (e.g. a stalled first-run download). */
const LOAD_TIMEOUT_MS = Number(process.env.HERMIT_EMBED_LOAD_TIMEOUT_MS || 120_000);

/**
 * Get or create the feature extraction pipeline (singleton).
 * Returns null if the model fails to load (graceful fallback).
 *
 * The singleton is the PROMISE, not the resolved value. Previously `_extractor`
 * was assigned only after `await pipeline(...)` resolved, so every concurrent
 * caller missed the `if (_extractor)` guard and started its own model load.
 * Session telemetry showed the effect clearly: N parallel tool calls all
 * finishing at the same late time with a tiny spread (e.g. 74.8s / 74.4s,
 * 262.2s / 262.2s) because they were each loading the ~23MB model at once and
 * blocking the event loop, which also starved unrelated calls like
 * hermit_open_nodes. Measured here: 6 concurrent cold embeds → all ~1.99s with
 * a 21ms spread, and a 982ms event-loop stall, on an already-cached model.
 */
async function getExtractor() {
  if (_extractor) return _extractor;
  if (_loadError) return null;
  if (_loadPromise) return _loadPromise;

  // Runtime never downloads. Only the explicit setup command opts in.
  if (!hasLocalModelCache() && !ALLOW_MODEL_DOWNLOAD) {
    _loadError = new Error('semantic model is not installed locally');
    return null;
  }

  _loadPromise = (async () => {
    let timer;
    try {
      const load = pipeline('feature-extraction', MODEL_ID, {
        dtype: 'fp32',
        local_files_only: !ALLOW_MODEL_DOWNLOAD,
      });
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`model load exceeded ${LOAD_TIMEOUT_MS}ms`)),
          LOAD_TIMEOUT_MS,
        );
      });
      _extractor = await Promise.race([load, timeout]);
      return _extractor;
    } catch (err) {
      // Cache the failure so callers fall back immediately instead of each
      // retrying a load that is known to be broken.
      _loadError = err;
      console.error(`[embedding-service] Failed to load model: ${err.message}`);
      return null;
    } finally {
      clearTimeout(timer);
      _loadPromise = null;
    }
  })();

  return _loadPromise;
}

/**
 * Load the model ahead of first use so the cost lands at startup instead of
 * inside a user-facing tool call. Fire-and-forget; failures are cached and
 * degrade to keyword search.
 * @returns {Promise<boolean>} true when the model is ready
 */
export async function warmup() {
  return (await getExtractor()) !== null;
}

/**
 * Embed a single text string into a 384-dim normalized vector.
 * @param {string} text - Input text
 * @returns {Promise<Float32Array|null>} 384-dim vector, or null if model unavailable
 */
export async function embed(text) {
  const extractor = await getExtractor();
  if (!extractor) return null;

  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data);
}

/**
 * Embed multiple texts in batch for efficiency.
 * @param {string[]} texts - Array of input texts
 * @param {number} batchSize - Process in chunks (default 50)
 * @returns {Promise<Float32Array[]|null>} Array of 384-dim vectors, or null
 */
export async function embedBatch(texts, batchSize = 50) {
  const extractor = await getExtractor();
  if (!extractor) return null;

  const results = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    for (const text of batch) {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      results.push(new Float32Array(output.data));
    }
  }
  return results;
}

/**
 * Compute cosine similarity between two normalized vectors.
 * For normalized vectors, cosine similarity = dot product.
 * @param {Float32Array} a - First vector
 * @param {Float32Array} b - Second vector
 * @returns {number} Similarity score in [-1, 1]
 */
export function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Check if embedding service is available (model loadable).
 * @returns {Promise<boolean>}
 */
export async function isAvailable() {
  const extractor = await getExtractor();
  return extractor !== null;
}

/** Reset singleton (for testing) */
export function reset() {
  _extractor = null;
  _loadError = null;
}

export { EMBEDDING_DIM, MODEL_ID };
