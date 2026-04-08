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
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// Cache model in data/.model-cache/ (gitignored via data/)
env.cacheDir = join(PROJECT_ROOT, 'data', '.model-cache');

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

let _extractor = null;
let _loadError = null;

/**
 * Get or create the feature extraction pipeline (singleton).
 * Returns null if model fails to load (graceful fallback).
 */
async function getExtractor() {
  if (_extractor) return _extractor;
  if (_loadError) return null;

  try {
    _extractor = await pipeline('feature-extraction', MODEL_ID, {
      dtype: 'fp32',
    });
    return _extractor;
  } catch (err) {
    _loadError = err;
    console.error(`[embedding-service] Failed to load model: ${err.message}`);
    return null;
  }
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
