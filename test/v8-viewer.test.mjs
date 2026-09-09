import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';import {once} from 'node:events';import {request} from 'node:http';
import {BrainStore} from '../scripts/lib/storage/brain-store.mjs';
test('loopback viewer bundles assets, rejects remote origins/writes and observes SQLite changes',async t=>{
 const root=mkdtempSync(join(tmpdir(),'hermit-viewer-')),cwd=join(root,'project'),data=join(root,'data');mkdirSync(cwd);const dbPath=join(data,'brain.db');let store=new BrainStore({dbPath});const project=store.createProject({name:'Viewer',rootPath:cwd});store.createEntity({name:'TECH:Visible',entityType:'tech-config',projectId:project.id});store.close();
 const child=spawn(process.execPath,[resolve('scripts/view-graph.mjs'),'--serve-only'],{cwd,env:{...process.env,HERMIT_DATA_DIR:data,HERMIT_DB_PATH:'',HERMIT_USER_CWD:cwd},stdio:['ignore','pipe','pipe'],windowsHide:true});
 t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}rmSync(root,{recursive:true,force:true});});
 const url=await new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(Error('Viewer startup timed out: '+errors)),10000);child.stderr.on('data',d=>errors+=d);child.on('error',reject);child.on('exit',()=>{clearTimeout(timer);reject(Error(errors));});child.stdout.on('data',d=>{output+=d;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});});
 const get=(path,options={})=>new Promise((resolve,reject)=>{const req=request(url+path,options,res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end();});
 const page=await get('/');assert.equal(page.status,200);assert.doesNotMatch(page.body,/<script src="https?:/);assert.match(page.body,/TECH:Visible/);
 assert.equal((await get('/api/graph',{headers:{Origin:'https://untrusted.example'}})).status,403);assert.equal((await get('/api/graph',{headers:{Host:'untrusted.example'}})).status,403);assert.equal((await get('/api/graph',{method:'POST'})).status,405);
 store=new BrainStore({dbPath});store.createEntity({name:'TECH:New',entityType:'tech-config',projectId:project.id});store.close();const updated=await get('/api/graph');assert.match(updated.body,/TECH:New/);assert.equal(updated.headers['access-control-allow-origin'],undefined);
});
