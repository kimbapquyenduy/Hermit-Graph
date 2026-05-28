/**
 * discover-bridges.test.mjs — Tests for bridge config discovery + namespace registry.
 *
 * Uses tmp files via HERMIT_BRIDGES_PATH env var — never touches real ~/.hermit/mcp-bridges.json.
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { discoverBridges } from '../scripts/lib/mcp-bridge/discover-bridges.mjs';
import { BridgeRegistry, namespaceTool, sanitizeToolName } from '../scripts/lib/mcp-bridge/bridge-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '..', 'tmp', 'test-05b');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function writeTmp(filename, content) {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
  const p = join(TMP, filename);
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

console.log('\nPhase 05b — discover-bridges + bridge-registry tests');
console.log('====================================================');

// ── discoverBridges ──────────────────────────────────────────────────────────

test('missing config file returns empty valid list', () => {
  const result = discoverBridges(join(TMP, 'nonexistent.json'));
  assert(Array.isArray(result.valid), 'valid should be array');
  assert(result.valid.length === 0, 'valid should be empty');
  assert(Array.isArray(result.invalid), 'invalid should be array');
});

test('valid config returns all entries as valid', () => {
  const p = writeTmp('valid.json', [
    { name: 'time', transport: 'stdio', command: 'npx', args: ['-y', 'mcp-server-time'], enabled: false },
    { name: 'remote_api', transport: 'http', url: 'http://localhost:3001/mcp', enabled: false },
  ]);
  const { valid, invalid } = discoverBridges(p);
  assert(valid.length === 2, `expected 2 valid, got ${valid.length}`);
  assert(invalid.length === 0, `expected 0 invalid, got ${invalid.length}`);
  assert(valid[0].name === 'time', 'first entry should be time');
  assert(valid[1].name === 'remote_api', 'second entry should be remote_api');
});

test('defaults: transport defaults to stdio, enabled defaults to false', () => {
  const p = writeTmp('defaults.json', [
    { name: 'mybridge', command: 'node', args: ['server.mjs'] },
  ]);
  const { valid } = discoverBridges(p);
  assert(valid.length === 1, 'should have 1 valid entry');
  assert(valid[0].transport === 'stdio', `transport default should be stdio, got ${valid[0].transport}`);
  assert(valid[0].enabled === false, `enabled default should be false, got ${valid[0].enabled}`);
});

test('malformed JSON returns empty valid list and logs error', () => {
  const p = writeTmp('malformed.json', '{ not valid json ][');
  const { valid, invalid } = discoverBridges(p);
  assert(valid.length === 0, 'valid should be empty on malformed JSON');
  assert(invalid.length === 1, 'should have 1 invalid entry');
  assert(invalid[0].error.includes('JSON'), `error should mention JSON, got: ${invalid[0].error}`);
});

test('non-array JSON returns empty valid list', () => {
  const p = writeTmp('object.json', '{"name": "time"}');
  const { valid, invalid } = discoverBridges(p);
  assert(valid.length === 0, 'valid should be empty');
  assert(invalid.length === 1, 'should have 1 invalid');
});

test('invalid name (uppercase) is skipped and logged', () => {
  const p = writeTmp('bad-name.json', [
    { name: 'ValidName', transport: 'stdio', command: 'node', enabled: false },
  ]);
  const { valid, invalid } = discoverBridges(p);
  assert(valid.length === 0, 'uppercase name should be rejected');
  assert(invalid.length === 1, 'should be in invalid list');
  assert(invalid[0].error.toLowerCase().includes('name'), `error should mention name, got: ${invalid[0].error}`);
});

test('invalid name (starts with digit) is skipped', () => {
  const p = writeTmp('digit-name.json', [
    { name: '1bridge', transport: 'stdio', command: 'node', enabled: false },
  ]);
  const { valid, invalid } = discoverBridges(p);
  assert(valid.length === 0, 'digit-start name should be rejected');
  assert(invalid.length === 1, 'should be in invalid list');
});

test('missing command for stdio transport is skipped', () => {
  const p = writeTmp('no-command.json', [
    { name: 'nocommand', transport: 'stdio', enabled: false },
  ]);
  const { valid, invalid } = discoverBridges(p);
  assert(valid.length === 0, 'missing command should be rejected');
  assert(invalid.length === 1, 'should be in invalid list');
  assert(invalid[0].error.includes('command'), `error should mention command, got: ${invalid[0].error}`);
});

test('missing url for http transport is skipped', () => {
  const p = writeTmp('no-url.json', [
    { name: 'nourl', transport: 'http', enabled: false },
  ]);
  const { valid, invalid } = discoverBridges(p);
  assert(valid.length === 0, 'missing url should be rejected');
  assert(invalid.length === 1, 'should be in invalid list');
});

test('mixed valid and invalid entries — valid ones survive', () => {
  const p = writeTmp('mixed.json', [
    { name: 'good', transport: 'stdio', command: 'node', enabled: true },
    { name: 'BadName', transport: 'stdio', command: 'node', enabled: false },
    { name: 'also_good', transport: 'http', url: 'http://localhost:9999/mcp', enabled: false },
  ]);
  const { valid, invalid } = discoverBridges(p);
  assert(valid.length === 2, `expected 2 valid, got ${valid.length}`);
  assert(invalid.length === 1, `expected 1 invalid, got ${invalid.length}`);
  assert(valid[0].name === 'good', 'first valid should be good');
  assert(valid[1].name === 'also_good', 'second valid should be also_good');
});

test('disabled entries are returned in valid list (but flagged disabled)', () => {
  const p = writeTmp('disabled.json', [
    { name: 'off', transport: 'stdio', command: 'node', enabled: false },
    { name: 'on', transport: 'stdio', command: 'node', enabled: true },
  ]);
  const { valid } = discoverBridges(p);
  assert(valid.length === 2, 'both entries should be in valid list');
  const off = valid.find(e => e.name === 'off');
  const on = valid.find(e => e.name === 'on');
  assert(off && off.enabled === false, 'off entry should have enabled:false');
  assert(on && on.enabled === true, 'on entry should have enabled:true');
});

test('empty array config returns empty valid list (Brain still boots)', () => {
  const p = writeTmp('empty.json', []);
  const { valid, invalid } = discoverBridges(p);
  assert(valid.length === 0, 'empty array should yield no valid entries');
  assert(invalid.length === 0, 'empty array should yield no invalid entries');
});

test('duplicate bridge name: second is rejected', () => {
  const p = writeTmp('dupe.json', [
    { name: 'twin', transport: 'stdio', command: 'node', enabled: false },
    { name: 'twin', transport: 'stdio', command: 'node', enabled: false },
  ]);
  const { valid, invalid } = discoverBridges(p);
  assert(valid.length === 1, `expected 1 valid, got ${valid.length}`);
  assert(invalid.length === 1, `expected 1 invalid (duplicate), got ${invalid.length}`);
});

// ── BridgeRegistry ───────────────────────────────────────────────────────────

test('register + resolve round-trip', () => {
  const reg = new BridgeRegistry();
  const ns = reg.register({ bridge: 'time', originalToolName: 'get_current_time', schema: { type: 'object' } });
  assert(ns === 'mcp_time_get_current_time', `expected mcp_time_get_current_time, got ${ns}`);
  const entry = reg.resolve(ns);
  assert(entry !== null, 'resolve should return entry');
  assert(entry.bridge === 'time', 'bridge mismatch');
  assert(entry.originalToolName === 'get_current_time', 'toolName mismatch');
});

test('resolve unknown name returns null', () => {
  const reg = new BridgeRegistry();
  assert(reg.resolve('mcp_unknown_foo') === null, 'unknown name should return null');
});

test('list() returns all registered entries', () => {
  const reg = new BridgeRegistry();
  reg.register({ bridge: 'a', originalToolName: 'tool1' });
  reg.register({ bridge: 'a', originalToolName: 'tool2' });
  reg.register({ bridge: 'b', originalToolName: 'tool1' });
  assert(reg.list().length === 3, `expected 3, got ${reg.list().length}`);
});

test('sanitizeToolName replaces special chars with _', () => {
  assert(sanitizeToolName('get-current-time') === 'get_current_time', 'hyphens should become _');
  assert(sanitizeToolName('foo.bar') === 'foo_bar', 'dot should become _');
  assert(sanitizeToolName('tool name') === 'tool_name', 'space should become _');
  assert(sanitizeToolName('valid_name') === 'valid_name', 'underscores preserved');
});

test('namespaceTool builds correct prefix', () => {
  assert(namespaceTool('mybridge', 'do_thing') === 'mcp_mybridge_do_thing', 'namespace wrong');
  assert(namespaceTool('srv', 'my-tool') === 'mcp_srv_my_tool', 'hyphen not sanitized');
});

test('removeBridge removes only that bridge entries', () => {
  const reg = new BridgeRegistry();
  reg.register({ bridge: 'a', originalToolName: 'x' });
  reg.register({ bridge: 'a', originalToolName: 'y' });
  reg.register({ bridge: 'b', originalToolName: 'x' });
  const removed = reg.removeBridge('a');
  assert(removed.length === 2, `expected 2 removed, got ${removed.length}`);
  assert(reg.list().length === 1, `expected 1 remaining, got ${reg.list().length}`);
  assert(reg.list()[0].bridge === 'b', 'remaining entry should be bridge b');
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

try {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
} catch { /* ignore cleanup errors */ }

console.log(`\n📊 Phase 05b results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
