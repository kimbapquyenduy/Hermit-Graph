/**
 * Shared helpers for MemoryProvider contract tests.
 * Re-exported by all contract test modules.
 */

import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JsonlProvider } from '../scripts/lib/memory/jsonl-provider.mjs';
import { writeBrain } from '../scripts/lib/brain-io.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
export const TMP = join(ROOT, 'tmp', 'contract-test');

let _passed = 0;
let _failed = 0;

/** Returns current pass/fail counts. Use instead of direct export for live values. */
export function getResults() { return { passed: _passed, failed: _failed }; }

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

export async function test(name, fn) {
  try {
    await fn();
    _passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    _failed++;
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
}

/** Build a fresh provider backed by a unique temp brain file. */
export function makeProvider(filename = 'brain.jsonl') {
  const brainPath = join(TMP, filename);
  return new JsonlProvider({ brainPath });
}

/** Seed a provider's brain file with vault data. */
export function seedProvider(provider, vault) {
  writeBrain(provider._brainPath, vault.entities, vault.relations);
}

export function setup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP, { recursive: true });
}

export function cleanup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
}
