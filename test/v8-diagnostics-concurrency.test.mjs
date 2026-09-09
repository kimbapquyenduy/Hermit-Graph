import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {BrainStore} from '../scripts/lib/storage/brain-store.mjs';
import {DiagnosticsStore,DIAGNOSTICS_SCHEMA_SQL} from '../scripts/lib/diagnostics/store.mjs';
test('16 processes x 1000 failures atomically retain exactly 16000 in one fingerprint',async t=>{const root=mkdtempSync(join(tmpdir(),'hermit-diag-concurrent-'));const dbPath=join(root,'brain.db'),brain=new BrainStore({dbPath});brain.db.exec(DIAGNOSTICS_SCHEMA_SQL);const script=join(root,'writer.mjs');writeFileSync(script,`import {DiagnosticsStore} from ${JSON.stringify(new URL('../scripts/lib/diagnostics/store.mjs',import.meta.url).href)};const store=new DiagnosticsStore({dbPath:process.argv[2],maxRetryMs:30000});for(let i=0;i<1000;i++)store.record({code:'HERMIT_TEST_FAILURE'});store.close();`);t.after(()=>{brain.close();rmSync(root,{recursive:true,force:true});});await Promise.all(Array.from({length:16},()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[script,dbPath],{stdio:['ignore','ignore','pipe'],windowsHide:true});let error='';child.stderr.on('data',d=>error+=d);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(error)));})));const store=new DiagnosticsStore({brainStore:brain});try{assert.equal(store.summary().failures,16000);assert.equal(store.list().length,1);assert.equal(store.list()[0].total,16000);assert.equal(store.samples(store.list()[0].id).length,5);}finally{store.close();}});
