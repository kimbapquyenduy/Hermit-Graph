#!/usr/bin/env node
/**
 * Memory provider benchmark — measures JsonlProvider against a deterministic
 * 500-entity fixture. Saves results to test/baseline-v6.7.json.
 *
 * Run: node scripts/test-memory-bench.mjs
 * Output shape: { date, version, fixtures, keyword, readAll, write }
 *
 * IMPORTANT: runs against synthetic fixture only — never touches data/brain.jsonl.
 */

import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JsonlProvider } from './lib/memory/jsonl-provider.mjs';
import { generateSampleVault } from './lib/memory/test-fixtures.mjs';
import { writeBrain } from './lib/brain-io.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIXTURE_DIR = join(ROOT, 'test', 'fixtures');
const FIXTURE_PATH = join(FIXTURE_DIR, 'sample-vault-500.jsonl');
const BASELINE_PATH = join(ROOT, 'test', 'baseline-v6.7.json');

const FIXTURE_SIZE = 500;
const FIXTURE_SEED = 42;
const KEYWORD_QUERIES = [
  'Auth', 'Payment', 'Order', 'cache timeout', 'batch size',
  'rate limit', 'webhook handler', 'token validator', 'pipeline pattern',
  'registry adapter', 'session export', 'config strategy', 'import factory',
  'search dispatcher', 'event scheduler', 'report gateway', 'user service',
  'incident bug', 'decision rule', 'pattern arch',
  'retry threshold', 'queue encoder', 'biz domain', 'tech stack',
  'flow trigger', 'entity parser', 'integration protocol', 'config registry',
  'gotcha edge case', 'tech decision adapter',
  // second pass — ensure 50 total
  'Auth timeout', 'Payment gateway', 'Order batch', 'cache miss', 'limit exceeded',
  'handler factory', 'token expired', 'pipeline stage', 'adapter pattern',
  'session context', 'export import', 'search result', 'event loop',
  'report format', 'user config', 'incident root', 'decision context',
  'arch strategy', 'integration bus', 'gotcha detail',
];

/** Compute p50, p95, avg from sorted latency array (ms). */
function percentiles(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return {
    p50: Math.round(p50 * 100) / 100,
    p95: Math.round(p95 * 100) / 100,
    avg: Math.round(avg * 100) / 100,
    count: sorted.length,
  };
}

/** Write fixture to temp JSONL file so JsonlProvider can read it. */
function buildFixtureFile(vault) {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  writeBrain(FIXTURE_PATH, vault.entities, vault.relations);
}

async function main() {
  const pkg = JSON.parse((await import('fs')).readFileSync(join(ROOT, 'package.json'), 'utf-8'));

  console.log('Memory Provider Benchmark');
  console.log('=========================');
  console.log(`Fixture: ${FIXTURE_SIZE} entities, seed=${FIXTURE_SEED}`);
  console.log(`Output:  test/baseline-v6.7.json`);
  console.log('');

  // ── Build fixture ──
  process.stdout.write('Generating fixture... ');
  const vault = generateSampleVault({ size: FIXTURE_SIZE, seed: FIXTURE_SEED });
  buildFixtureFile(vault);
  console.log(`done (${vault.entities.size} entities, ${vault.relations.length} relations)`);

  const provider = new JsonlProvider({ brainPath: FIXTURE_PATH });

  // ── readAll latency ──
  process.stdout.write('Benchmarking readAll... ');
  const readStart = performance.now();
  const { entities: readEntities } = await provider.readAll();
  const readMs = Math.round((performance.now() - readStart) * 100) / 100;
  console.log(`${readMs}ms (${readEntities.size} entities loaded)`);

  // ── keyword search p50/p95 (50 queries) ──
  process.stdout.write('Benchmarking keyword search (50 queries)... ');
  const kwLatencies = [];
  const queries = KEYWORD_QUERIES.slice(0, 50);
  // pad if needed
  while (queries.length < 50) queries.push(queries[queries.length - 1]);

  for (const q of queries) {
    const t0 = performance.now();
    await provider.searchKeyword(q, { topK: 10 });
    kwLatencies.push(performance.now() - t0);
  }
  const kwStats = percentiles(kwLatencies);
  console.log(`done  p50=${kwStats.p50}ms  p95=${kwStats.p95}ms  avg=${kwStats.avg}ms`);

  // ── write throughput (100 writes) ──
  process.stdout.write('Benchmarking write throughput (100 writes)... ');
  const writeCount = 100;
  const writeStart = performance.now();

  await provider.withLock(async () => {
    for (let i = 0; i < writeCount; i++) {
      await provider.writeEntity({
        type: 'entity',
        name: `BENCH:Write:Entity${i}`,
        entityType: 'tech-stack',
        observations: [`[0.8|2026-01-01] NOTE: bench write entity ${i}`],
      });
    }
  });

  const writeTotalMs = performance.now() - writeStart;
  const writeThroughput = Math.round((writeCount / (writeTotalMs / 1000)) * 10) / 10;
  console.log(`done  ${writeCount} writes in ${Math.round(writeTotalMs)}ms  (${writeThroughput} writes/sec)`);

  // ── Build result ──
  const result = {
    date: new Date().toISOString(),
    version: pkg.version,
    fixtures: { size: FIXTURE_SIZE, seed: FIXTURE_SEED },
    keyword: kwStats,
    readAll: { ms: readMs },
    write: { totalMs: Math.round(writeTotalMs), count: writeCount, throughputPerSec: writeThroughput },
  };

  // ── Save baseline ──
  if (!existsSync(join(ROOT, 'test'))) mkdirSync(join(ROOT, 'test'), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(result, null, 2) + '\n');
  console.log('');
  console.log(`Baseline saved: test/baseline-v6.7.json`);
  console.log(JSON.stringify(result, null, 2));

  // ── Cleanup volatile fixture (keep baseline, gitignore fixtures/) ──
  // Fixture file stays on disk for contract tests to use, but is gitignored.
  // Remove the 100 bench-write entities from the fixture to avoid polluting contract tests.
  const cleanVault = generateSampleVault({ size: FIXTURE_SIZE, seed: FIXTURE_SEED });
  buildFixtureFile(cleanVault);
}

main().catch(err => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
