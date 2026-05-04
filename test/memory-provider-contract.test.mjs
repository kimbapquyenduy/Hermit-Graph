#!/usr/bin/env node
/**
 * MemoryProvider contract conformance suite — entry runner.
 * Delegates to read-tests and write-tests modules.
 * Any future provider can be tested by swapping the JsonlProvider import
 * inside memory-contract-helpers.mjs.
 *
 * Run: node test/memory-provider-contract.test.mjs
 */

import { setup, cleanup, getResults } from './memory-contract-helpers.mjs';
import { runReadTests } from './memory-contract-read-tests.mjs';
import { runWriteTests } from './memory-contract-write-tests.mjs';

setup();
try {
  await runReadTests();
  await runWriteTests();
} finally {
  cleanup();
}

const { passed, failed } = getResults();
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
