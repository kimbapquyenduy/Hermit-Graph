#!/usr/bin/env node
/**
 * publish-preflight.mjs — Pre-publish validation for Hermit Graph
 *
 * Runs 8 checks before npm publish:
 * 1. Git working tree clean
 * 2. Version matches changelog
 * 3. README "What's New" matches version (skip if section absent)
 * 4. Unit tests pass (test-v4.mjs)
 * 5. E2E tests pass (test-e2e-code-intel.mjs)
 * 6. No secrets in package files
 * 7. npm pack dry-run OK
 * 8. Node >= 20
 *
 * Wired as prepublishOnly in package.json.
 * Exit 0 = all clear, Exit 1 = blocked.
 */

import { readFileSync, existsSync } from 'fs';
import { execSync, execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Helpers ──────────────────────────────────────────────

const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';
const SKIP = '\x1b[33m[SKIP]\x1b[0m';

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    const result = fn();
    if (result === 'skip') {
      console.log(`${SKIP} ${label}`);
      return;
    }
    console.log(`${PASS} ${label}${result ? ` (${result})` : ''}`);
    passed++;
  } catch (err) {
    console.log(`${FAIL} ${label}`);
    console.log(`       ${err.message}`);
    failed++;
  }
}

function readFile(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf-8');
}

// ── Main ─────────────────────────────────────────────────

const pkg = JSON.parse(readFile('package.json'));
const version = pkg.version;

console.log(`\nHermit Graph — Publish Preflight v${version}`);
console.log('='.repeat(44));
console.log();

// 1. Git clean
check('Git working tree is clean', () => {
  const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf-8' }).trim();
  if (status) {
    const lines = status.split('\n').length;
    throw new Error(`${lines} uncommitted change(s). Commit or stash before publishing.`);
  }
});

// 2. Changelog version match
check(`Version ${version} matches changelog`, () => {
  const changelog = readFile('docs/project-changelog.md');
  const pattern = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm');
  if (!pattern.test(changelog)) {
    throw new Error(`No [${version}] entry found in docs/project-changelog.md`);
  }
});

// 3. README "What's New" match (optional — skip if section removed)
check('README "What\'s New" matches version', () => {
  const readme = readFile('README.md');
  const hasWhatsNew = /^## What's New in v/m.test(readme);
  if (!hasWhatsNew) return 'skip';
  const pattern = new RegExp(`^## What's New in v${version.replace(/\./g, '\\.')}`, 'm');
  if (!pattern.test(readme)) {
    throw new Error(`README "What's New" heading doesn't match v${version}`);
  }
});

// 4. Unit tests
check('Unit tests pass', () => {
  const testFile = join(__dirname, 'test-v4.mjs');
  if (!existsSync(testFile)) throw new Error('test-v4.mjs not found');
  const output = execFileSync(process.execPath, [testFile], {
    cwd: ROOT, encoding: 'utf-8', timeout: 120_000,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  // Extract results line
  const match = output.match(/(\d+) passed, (\d+) failed/);
  if (!match) throw new Error('Could not parse test output');
  const [, p, f] = match;
  if (parseInt(f) > 0) throw new Error(`${f} test(s) failed`);
  return `${p} passed`;
});

// 5. E2E tests
check('E2E tests pass', () => {
  const testFile = join(__dirname, 'test-e2e-code-intel.mjs');
  if (!existsSync(testFile)) return 'skip';
  const output = execFileSync(process.execPath, [testFile], {
    cwd: ROOT, encoding: 'utf-8', timeout: 120_000,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const match = output.match(/(\d+) passed/);
  if (!match) throw new Error('Could not parse e2e test output');
  if (output.includes('failed')) {
    const fMatch = output.match(/(\d+) failed/);
    if (fMatch && parseInt(fMatch[1]) > 0) throw new Error(`${fMatch[1]} e2e test(s) failed`);
  }
  return `${match[1]} passed`;
});

// 6. No secrets in package files
check('No secrets in package files', () => {
  const secretPatterns = ['.env', '.npmrc', 'credentials', 'secret', '.key', '.pem', '.p12'];
  const files = pkg.files || [];
  for (const f of files) {
    for (const pat of secretPatterns) {
      if (f.toLowerCase().includes(pat)) {
        throw new Error(`Suspicious file in "files" array: ${f} (matches "${pat}")`);
      }
    }
  }
  // Also check that data/ and .claude/ are NOT in files
  const dangerous = ['data/', '.claude/', 'docker/', '.npmrc'];
  for (const d of dangerous) {
    if (files.some(f => f.startsWith(d))) {
      throw new Error(`"${d}" should not be in package.json "files" array`);
    }
  }
});

// 7. npm pack dry-run
check('npm pack dry-run OK', () => {
  const output = execSync('npm pack --dry-run 2>&1', { cwd: ROOT, encoding: 'utf-8' });
  const lines = output.trim().split('\n');
  // Count files (lines that start with npm notice filename)
  const fileLines = lines.filter(l => /^npm notice \d/.test(l) || l.includes('Tarball'));
  const sizeMatch = output.match(/unpacked size:\s*([\d.]+\s*\w+)/i);
  const size = sizeMatch ? sizeMatch[1] : 'unknown';
  return `${size}`;
});

// 8. Node engine
check('Node >= 20', () => {
  const major = parseInt(process.version.slice(1));
  if (major < 20) throw new Error(`Node ${process.version} < 20. Upgrade to Node 20+.`);
  return process.version;
});

// ── Summary ──────────────────────────────────────────────

console.log();
if (failed > 0) {
  console.log(`\x1b[31m${failed} check(s) failed. Fix before publishing.\x1b[0m`);
  process.exit(1);
} else {
  console.log(`\x1b[32mAll ${passed} checks passed. Ready to publish.\x1b[0m`);
}
