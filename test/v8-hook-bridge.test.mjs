import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {BrainStore} from '../scripts/lib/storage/brain-store.mjs';
test('hook bridge captures scoped candidates atomically and ignores knowledge JSONL',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hook-db-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const cwd=join(dir,'project');mkdirSync(cwd);
 const legacy=join(dir,'brain.jsonl');writeFileSync(legacy,'SENTINEL');const env={...process.env,HERMIT_DATA_DIR:join(dir,'data'),BRAIN_FILE:legacy};
 const call=input=>{const r=spawnSync(process.execPath,[resolve('scripts/hermit-hook.mjs')],{input:JSON.stringify({...input,cwd}),encoding:'utf8',env});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const entities=[{name:'TECH:Hook',entityType:'tech-stack',observations:['needle']}];assert.equal(call({op:'capture',entities}).count,1);assert.equal(call({op:'capture',entities}).count,0);
 assert.equal(call({op:'graph'}).entities.length,0);const graph=call({op:'graph',includeCandidates:true});assert.equal(graph.entities[0].lifecycle,'candidate');assert.equal(readFileSync(legacy,'utf8'),'SENTINEL');
 const s=new BrainStore({dbPath:join(dir,'data','brain.db')});s.transitionEntity({id:graph.entities[0].id,to:'active'});s.close();assert.equal(call({op:'capture',entities:[{...entities[0],observations:['untrusted']}]}).count,0);assert.equal(call({op:'graph'}).entities[0].observations.length,1);
});

import {copyLibDir} from '../scripts/lib/hook-export.mjs';
test('exported hook bridge resolves runtime without package environment override',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hook-copy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const libs=join(dir,'lib');copyLibDir(resolve('catalog/hooks/lib'),libs);
 const env={...process.env,HERMIT_DATA_DIR:join(dir,'data')};delete env.HERMIT_PACKAGE_ROOT;
 const r=spawnSync(process.execPath,['-e',`process.stdout.write(JSON.stringify(require(${JSON.stringify(join(libs,'sqlite-bridge.cjs'))}).invoke({op:'paths'})))`],{encoding:'utf8',env});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).dbPath,join(dir,'data','brain.db'));
});

test('all update adapters honor payload cwd and save only SQLite candidates',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hook-adapters-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const env={...process.env,HERMIT_DATA_DIR:join(dir,'data'),HERMIT_USER_CWD:dir};
 for(const suffix of ['', '-codex','-cursor','-cline','-gemini']){
  const cwd=join(dir,'project'+(suffix||'-claude'));mkdirSync(cwd);
  const r=spawnSync(process.execPath,[resolve('catalog/hooks/kg-auto-update'+suffix+'.cjs')],{env,encoding:'utf8',input:JSON.stringify({cwd,conversation:[{role:'assistant',content:'We chose PostgreSQL because reliable persistent storage is required for this application.'}]})});assert.equal(r.status,0,r.stderr);
 }
 const store=new BrainStore({dbPath:join(dir,'data','brain.db')});try{const projects=store.listProjects();assert.equal(projects.length,5);for(const p of projects){assert.ok(store.listEntities({projectId:p.id,lifecycles:['candidate']}).length>0);assert.equal(store.listEntities({projectId:p.id}).length,0);}}finally{store.close();}
});
