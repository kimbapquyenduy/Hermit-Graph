import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {BrainStore} from '../scripts/lib/storage/brain-store.mjs';
import {exportKnowledge,viewerRows} from '../scripts/lib/export-v8.mjs';
import {createBackup,previewRestore,restoreBackup} from '../scripts/lib/maintenance/backup-service.mjs';
test('knowledge export and SQLite restore preserve identities, empty projects, lifecycles and history',async t=>{
 const root=mkdtempSync(join(tmpdir(),'hermit-export-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const dbPath=join(root,'brain.db');let store=new BrainStore({dbPath});
 mkdirSync(join(root,'primary'));mkdirSync(join(root,'empty'));
 const project=store.createProject({name:'Primary',rootPath:join(root,'primary')}),empty=store.createProject({name:'Empty',rootPath:join(root,'empty')});
 const a=store.createEntity({name:'TECH:Shared',entityType:'tech-config',projectId:project.id,observations:['ENV: first','URLS: example'],provenance:{source:'reviewed'}}).entity;
 const b=store.createEntity({name:'TECH:Candidate',entityType:'tech-config',projectId:project.id,lifecycle:'candidate',observations:['ENV: guess']}).entity;
 store.createRelation({fromEntityId:a.id,toEntityId:b.id,relationType:'depends_on'});store.transitionObservation({id:a.observations[0].id,to:'archived'});
 const before=exportKnowledge(store,{all:true});assert.ok(before.projects.some(p=>p.id===empty.id));assert.ok(before.entities.find(e=>e.id===a.id).observations.some(o=>o.lifecycle==='archived'));assert.equal(viewerRows(before).filter(r=>r.type==='relation').length,0);assert.ok(before.history.length);
 store.close();await createBackup(dbPath,join(root,'backup'));store=new BrainStore({dbPath});store.createEntity({name:'TECH:Later',entityType:'tech-config'});store.close();const preview=previewRestore(dbPath,join(root,'backup'));await restoreBackup(dbPath,join(root,'backup'),{confirmation:JSON.stringify(preview)});store=new BrainStore({dbPath,readOnly:true});try{assert.deepEqual(exportKnowledge(store,{all:true}),before);}finally{store.close();}
});
