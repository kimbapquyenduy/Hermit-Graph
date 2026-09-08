import test from 'node:test';
import {createHash} from 'node:crypto';
import {ModelManager,MODEL_ID,REQUIRED_ARTIFACTS} from '../scripts/lib/v8-model.mjs';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {BrainStore} from '../scripts/lib/storage/brain-store.mjs';
const cli=resolve('scripts/brain-cli.mjs');
function run(cwd,data,args,extra={}){return spawnSync(process.execPath,[cli,...args],{cwd,env:{...process.env,HERMIT_DATA_DIR:data,HERMIT_DB_PATH:'',HERMIT_STORAGE:'v8',HERMIT_USER_CWD:'',...extra},encoding:'utf8'});}
test('doctor never initializes absent store or mutates caller cwd',()=>{const cwd=mkdtempSync(join(tmpdir(),'v8-cli-'));const r=run(cwd,join(cwd,'missing'),['doctor']);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).status,'unhealthy');assert.deepEqual(readdirSync(cwd),[]);});
test('scoped CLI search, forked doctor, health, snapshot and backup',()=>{const root=mkdtempSync(join(tmpdir(),'v8-cli-'));const cwd=join(root,'project');mkdirSync(cwd);const data=join(root,'data');const s=new BrainStore({dbPath:join(data,'brain.db')});const p=s.createProject({name:'project',rootPath:cwd});const obs=['[0.9|2026-09-08] WHAT: needle pattern','[0.9|2026-09-08] WHEN: testing','[0.9|2026-09-08] HOW: test fixture','[0.9|2026-09-08] TRADEOFF: none'];s.createEntity({name:'PATTERN:Same',entityType:'pattern-arch',observations:obs});s.createEntity({name:'PATTERN:Same',entityType:'pattern-arch',projectId:p.id,observations:obs});s.close();let local=run(cwd,data,['search','needle','--json']);assert.equal(local.status,0,local.stderr);assert.equal(JSON.parse(local.stdout).length,1);let r=run(cwd,data,['search','needle','--json','--include-global']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).length,2);r=run(cwd,data,['doctor']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).entities,1);assert.equal(JSON.parse(r.stdout).status,'healthy');r=run(cwd,data,['doctor'],{HERMIT_SEARCH_MODE:'hybrid'});assert.equal(JSON.parse(r.stdout).status,'degraded');r=run(cwd,data,['health']);assert.match(r.stdout,/Brain Health Report/);assert.doesNotMatch(r.stderr,/TypeError/);r=run(cwd,data,['view','--no-open']);assert.equal(r.status,0,r.stderr);const html=readFileSync(r.stdout.trim().split('Read-only v8 snapshot: ')[1],'utf8');assert.match(html,/Read-only snapshot/);assert.match(html,/entityMap\[d.id \|\| d.name\]/);r=run(cwd,data,['backup','backup.db']);assert.equal(r.status,0,r.stderr);const restored=new BrainStore({dbPath:join(cwd,'backup.db'),readOnly:true});assert.equal(restored.listEntities({projectId:p.id,includeGlobal:true}).length,2);restored.close();r=run(cwd,data,['backup','backup.db']);assert.equal(r.status,1);assert.match(r.stderr,/already exists/);});

test('wrong schema is rejected without modifying existing database',()=>{
 const root=mkdtempSync(join(tmpdir(),'v8-cli-wrong-'));const dbPath=join(root,'brain.db');
 const db=new DatabaseSync(dbPath);db.exec("CREATE TABLE old_data(value TEXT); INSERT INTO old_data VALUES ('preserve'); PRAGMA user_version=7;");db.close();
 const before=readFileSync(dbPath);const r=run(root,root,['doctor']);assert.equal(r.status,1);assert.match(JSON.parse(r.stdout).error,/not v8/);assert.deepEqual(readFileSync(dbPath),before);
});

test('doctor detects installed model without creating vectors or loading inference',()=>{
 const root=mkdtempSync(join(tmpdir(),'v8-cli-model-'));const store=new BrainStore({dbPath:join(root,'brain.db')});store.close();
 const modelDir=join(root,'models',...MODEL_ID.split('/'));mkdirSync(join(modelDir,'onnx'),{recursive:true});const files={};
 for(const file of REQUIRED_ARTIFACTS){const value=file.endsWith('.json')?'{}':'test model bytes';writeFileSync(join(modelDir,file),value);files[file]=createHash('sha256').update(value).digest('hex');}
 writeFileSync(join(modelDir,'hermit-manifest.json'),JSON.stringify({version:1,model:MODEL_ID,dimension:384,files}));
 const before=readFileSync(join(root,'brain.db'));const r=run(root,root,['doctor'],{HERMIT_SEARCH_MODE:'hybrid'});assert.equal(r.status,0,r.stderr);const report=JSON.parse(r.stdout);assert.equal(report.model.installed,true);assert.equal(report.semanticEnabled,true);assert.equal(report.effectiveMode,'hybrid');assert.equal(report.runtimeValidated,false);assert.deepEqual(readFileSync(join(root,'brain.db')),before);
});

test('public model status command works without creating storage',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hermit-model-cli-'));
 try {const result=spawnSync(process.execPath,['scripts/brain-cli.mjs','model','status'],{encoding:'utf8',env:{...process.env,HERMIT_DATA_DIR:dir}});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).installed,false);assert.equal(existsSync(join(dir,'brain.db')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
