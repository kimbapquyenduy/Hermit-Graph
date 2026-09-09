import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BrainStore} from '../scripts/lib/storage/brain-store.mjs';
import {MemoryService} from '../scripts/lib/memory-service.mjs';
test('session scope isolates IDs and resource reads do not switch sessions',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hermit-service-')); const a=join(dir,'a'),b=join(dir,'b');mkdirSync(a);mkdirSync(b);
 const store=new BrainStore({dbPath:join(dir,'brain.db')});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const service=new MemoryService({store});service.startSession(a);
 const first=service.createEntities([{name:'TECH:Shared',entityType:'tech-stack',observations:['alpha']}])[0].entity;
 service.startSession(b);const second=service.createEntities([{name:'TECH:Shared',entityType:'tech-stack',observations:['beta']}])[0].entity;
 assert.notEqual(first.id,second.id);assert.equal(service.openNodes([first.id]).length,0);
 assert.equal(service.readGraph({cwd:a}).entities[0].id,first.id);
 assert.equal(service.readGraph().entities[0].id,second.id);
 service.transition(second.id,'archived');assert.equal(service.readGraph().entities.length,0);
 assert.equal(service.openNodes([second.id],{includeArchived:true}).length,1);
});

test('uninitialized writes are refused and global recall is explicit',t=>{
 const dir=mkdtempSync(join(tmpdir(),'hermit-session-'));const store=new BrainStore({dbPath:join(dir,'brain.db')});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const service=new MemoryService({store});assert.throws(()=>service.createEntities([]),{code:'HERMIT_SESSION_REQUIRED'});
 store.createEntity({name:'TECH:Global',entityType:'tech-stack',observations:['shared']});service.startSession(dir);
 assert.equal(service.search('shared').length,0);assert.equal(service.search('shared',{includeGlobal:true}).length,1);
});
