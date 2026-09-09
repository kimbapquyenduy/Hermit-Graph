import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('pre-edit reads scoped SQLite rules and never consults legacy knowledge JSONL', t => {
  const root = mkdtempSync(join(tmpdir(), 'v8-pre-edit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'code-symbols.jsonl'), JSON.stringify({ _type: 'symbol', id: 'app.js::run', name: 'run', file: 'app.js', kind: 'function', exported: true, line: [1, 2] }) + '\n');
  writeFileSync(join(root, 'data', 'brain.jsonl'), JSON.stringify({ type: 'entity', name: 'RULE:Legacy:Forbidden', entityType: 'biz-rule', observations: ['FILES: app.js'] }));
  const preload = join(root, 'preload.cjs');
  writeFileSync(preload, `
    const Module=require('node:module'), fs=require('node:fs'), assert=require('node:assert/strict');
    const original=Module._load;
    Module._load=function(id,...args){
      if(id.endsWith('sqlite-bridge.cjs'))return {readGraph({cwd}){assert.equal(cwd,process.env.CLAUDE_PROJECT_DIR);return {entities:[{name:'RULE:SQLite:Active',entityType:'biz-rule',observations:[{content:'FILES: app.js'}]}]};}};
      return original.call(this,id,...args);
    };
    const read=fs.readFileSync;
    fs.readFileSync=function(file,...args){if(String(file).endsWith('brain.jsonl'))throw Error('legacy knowledge read forbidden');return read.call(this,file,...args);};
  `);
  const result = spawnSync(process.execPath, ['--require', preload, resolve('catalog/hooks/kg-pre-edit-impact.cjs')], {
    encoding: 'utf8', input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(root, 'app.js') } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, HERMIT_PRE_EDIT_QUIET: '0' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /RULE:SQLite:Active/);
  assert.doesNotMatch(result.stderr, /RULE:Legacy|hook error|legacy knowledge read/);
});
