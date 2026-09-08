import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ModelManager, REQUIRED_ARTIFACTS, EMBEDDING_DIM } from '../scripts/lib/v8-model.mjs';

function fixture(t) {
  const dataDir=mkdtempSync(join(tmpdir(),'hermit-model-'));
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE entities(id TEXT PRIMARY KEY)');
  const entities=[{id:'a',name:'alpha',entityType:'pattern-code',observations:[{content:'first',lifecycle:'active'}]}];
  db.prepare('INSERT INTO entities VALUES (?)').run('a');
  const calls={load:0,install:0,embed:0};
  const engine={
    async install({modelDir}) {calls.install++;for(const file of REQUIRED_ARTIFACTS){mkdirSync(join(modelDir,file,'..'),{recursive:true});writeFileSync(join(modelDir,file),file.endsWith('.json')?'{}':'onnx');}},
    async load({localFilesOnly}) {assert.equal(localFilesOnly,true);calls.load++;return async text=>{calls.embed++;const v=new Float32Array(EMBEDDING_DIM);v[text.includes('second')?1:0]=1;return v;};},
  };
  const store={db,listEntities:()=>entities,search:()=>entities.map(e=>({...e,score:1}))};
  t.after(()=>{db.close();rmSync(dataDir,{recursive:true,force:true});});
  return {manager:new ModelManager({store,dataDir,engine}),calls,entities,dataDir,db};
}
test('status and uninstalled semantic fallback do not create files or load engine',async t=>{
  const {manager,calls,dataDir}=fixture(t);
  assert.equal(manager.status().installed,false);
  assert.equal((await manager.search('alpha',{mode:'hybrid'})).degraded,true);
  assert.equal(calls.load,0);assert.equal(calls.install,0);assert.equal(existsSync(join(dataDir,'models')),false);
});
test('explicit install validates every artifact and rejects checksum corruption',async t=>{
  const {manager,calls}=fixture(t);await manager.install();assert.equal(manager.status().installed,true);
  writeFileSync(join(manager.modelDir,'tokenizer_config.json'),'tampered');
  assert.equal(manager.status().installed,false);
  assert.equal((await manager.search('alpha',{mode:'vector'})).mode,'lexical');assert.equal(calls.load,0);
});
test('backfill reuses hashes, refreshes changed content and excludes retired entities',async t=>{
  const {manager,calls,entities,db}=fixture(t);await manager.install();
  assert.equal((await manager.backfill()).updated,1);assert.equal((await manager.backfill()).updated,0);
  assert.equal(calls.embed,1);entities[0].observations[0].content='second';
  assert.equal((await manager.backfill()).updated,1);
  assert.equal((await manager.search('second',{mode:'vector'})).entities[0].id,'a');
  entities.splice(0);assert.deepEqual((await manager.search('second',{mode:'vector'})).entities,[]);
  assert.equal(db.prepare('SELECT dimension FROM semantic_vectors').get().dimension,EMBEDDING_DIM);
});
test('scoped search and lexical default preserve scope without loading the model',async t=>{
  const {manager,calls}=fixture(t);
  const observed=[];
  manager.store.search=(query,options)=>{observed.push(options);return [];};
  await manager.install();
  assert.deepEqual((await manager.search('test',{projectId:'p',includeGlobal:true,topK:2})).entities,[]);
  assert.equal(calls.load,0);assert.deepEqual(observed,[{projectId:'p',includeGlobal:true,topK:2}]);
});
test('invalid engine vectors degrade to lexical without persisting invalid data',async t=>{
  const {manager,db}=fixture(t);await manager.install();
  manager.engine.load=async()=>async()=>[NaN];
  const result=await manager.search('alpha',{mode:'hybrid'});
  assert.equal(result.degraded,true);assert.match(result.reason,/invalid embedding/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semantic_vectors').get().n,0);
});
test('missing tokenizer configuration is rejected even with a remaining manifest',async t=>{
  const {manager}=fixture(t);await manager.install();
  rmSync(join(manager.modelDir,'tokenizer_config.json'));
  assert.equal(manager.status().installed,false);
});
test('all-project backfill visits each project and global exactly once',async t=>{
  const {manager}=fixture(t);await manager.install();
  const scopes=[];manager.store.listProjects=()=>[{id:'p1'},{id:'p2'}];
  manager.store.listEntities=options=>{scopes.push(options);return [];};
  assert.deepEqual(await manager.backfillAll(),{total:0,updated:0,unchanged:0});
  assert.deepEqual(scopes.map(s=>s.projectId),[null,'p1','p2']);
  assert.ok(scopes.every(s=>s.includeGlobal===false&&s.lifecycles[0]==='active'));
});
