import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {BrainStore} from '../scripts/lib/storage/brain-store.mjs';
import {DiagnosticsStore,DIAGNOSTICS_SCHEMA_SQL} from '../scripts/lib/diagnostics/store.mjs';
import {importSessions} from '../scripts/lib/diagnostics/session-import.mjs';
function setup(t,limits={}){const root=mkdtempSync(join(tmpdir(),'hermit-diag-bound-')),brain=new BrainStore({dbPath:join(root,'brain.db')});brain.db.exec(DIAGNOSTICS_SCHEMA_SQL);const store=new DiagnosticsStore({brainStore:brain,limits});t.after(()=>{store.close();brain.close();rmSync(root,{recursive:true,force:true});});return {store,brain,root};}
test('hard sample and protected fingerprint budgets retain exact lifetime failures',t=>{const {store}=setup(t,{fingerprints:1,occurrences:2,operations:2,buckets:1});for(let i=0;i<10;i++)store.record({code:i%2?'HERMIT_TIMEOUT':'HERMIT_RUNTIME_ERROR'},{operationId:randomUUID()});assert.equal(store.summary().failures,10);assert.equal(store.list().length,1);assert.ok(store.count('diag_occurrence')<=2);assert.ok(store.count('diag_operation')<=2);assert.ok(store.summary().dropped>0);assert.equal(store.count('diag_bucket'),1);});
test('streamed session import is content-idempotent, bounded and never persists transcript',async t=>{const {store,root}=setup(t);writeFileSync(join(root,'session.jsonl'),['{"isError":true,"message":"SENTINEL_PRIVATE_PASSWORD"}','{"isError":false}','x'.repeat(20000),'{"type":"error","token":"SENTINEL_PRIVATE_PASSWORD"}'].join('\n'));const result=await importSessions({root,store,maxLineBytes:1024});assert.equal(result.imported,2);assert.equal(result.oversized,1);assert.equal((await importSessions({root,store,maxLineBytes:1024})).imported,0);assert.equal(store.summary().failures,2);});
test('scope binds fingerprint identity, lookup, aggregates and promotion visibility',t=>{const {store,brain,root}=setup(t);const p=brain.createProject({name:'Private',rootPath:root});const {id}=store.record({code:'HERMIT_RUNTIME_ERROR'},{projectId:p.id});assert.equal(store.show(id),null);assert.equal(store.list().length,0);assert.equal(store.summary().failures,0);assert.equal(store.summary({projectId:p.id}).failures,1);assert.equal(store.show(id,{projectId:p.id}).total,1);});
