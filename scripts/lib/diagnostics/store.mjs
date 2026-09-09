import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { safeMetadata } from './redactor.mjs';
import { fingerprint } from './fingerprint.mjs';
import { assertTransition, STATES } from './state.mjs';
export const DIAGNOSTICS_SCHEMA_SQL=`
CREATE TABLE IF NOT EXISTS diag_fingerprint(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),code TEXT NOT NULL,component TEXT NOT NULL,phase TEXT NOT NULL,category TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN (${STATES.map(s=>`'${s}'`).join(',')})),first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,total INTEGER NOT NULL CHECK(total>0),regressions INTEGER NOT NULL DEFAULT 0,transition_count INTEGER NOT NULL DEFAULT 0,incident_entity_id TEXT REFERENCES entities(id),verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN(0,1))) STRICT;
CREATE TABLE IF NOT EXISTS diag_occurrence(id TEXT PRIMARY KEY,fingerprint_id TEXT NOT NULL REFERENCES diag_fingerprint(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,duration_ms INTEGER NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS diag_occurrence_fp ON diag_occurrence(fingerprint_id,created_at);
CREATE TABLE IF NOT EXISTS diag_bucket(day INTEGER NOT NULL,scope TEXT NOT NULL,component TEXT NOT NULL,successes INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,duration_ms INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,scope,component)) STRICT;
CREATE TABLE IF NOT EXISTS diag_operation(id TEXT PRIMARY KEY,trace_id TEXT NOT NULL,parent_id TEXT,state TEXT NOT NULL CHECK(state IN('FAILED_EXPECTED','FAILED_INTERNAL','FAILED_DEPENDENCY','TIMED_OUT','CANCELLED','ABANDONED')),late_state TEXT NOT NULL DEFAULT 'NONE' CHECK(late_state IN('NONE','PENDING_AFTER_TIMEOUT','LATE_SUCCEEDED','LATE_FAILED','LATE_CANCELLED')),created_at INTEGER NOT NULL,duration_ms INTEGER NOT NULL,fingerprint_id TEXT REFERENCES diag_fingerprint(id) ON DELETE SET NULL) STRICT;
CREATE TABLE IF NOT EXISTS diag_transition(id TEXT PRIMARY KEY,fingerprint_id TEXT NOT NULL REFERENCES diag_fingerprint(id) ON DELETE CASCADE,from_state TEXT NOT NULL,to_state TEXT NOT NULL,created_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS diag_session(id TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN('ACTIVE','CLOSED','ABANDONED')),started_at INTEGER NOT NULL,heartbeat_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS diag_import(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS diag_total(scope TEXT PRIMARY KEY,successes INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE TABLE IF NOT EXISTS diag_meta(key TEXT PRIMARY KEY CHECK(key IN('schema_version','dropped','pruned_failures','pruned_successes','prune_watermark')),value INTEGER NOT NULL) STRICT;
INSERT OR IGNORE INTO diag_meta VALUES('schema_version',1);
`;
export class DiagnosticsStore {
 constructor({brainStore,dbPath=brainStore?.dbPath,maxRetryMs=0,limits={}}={}){this.limits={fingerprints:5000,occurrences:2000,operations:20000,transitions:20000,sessions:5000,imports:5000,buckets:100000,totals:5001,...limits};this.maxRetryMs=maxRetryMs;this.db=new DatabaseSync(dbPath);try{this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=50;');if(this.db.prepare("SELECT value FROM diag_meta WHERE key='schema_version'").get()?.value!==1)throw Error('Unsupported diagnostics schema');}catch(error){this.db.close();throw error;}}
 close(){this.db.close();}
 count(table){return this.db.prepare('SELECT count(*) n FROM '+table).get().n;}
 transitionSample(id,from,to,time){
  this.db.prepare('UPDATE diag_fingerprint SET transition_count=transition_count+1 WHERE id=?').run(id);
  const row=this.db.prepare('SELECT state,incident_entity_id FROM diag_fingerprint WHERE id=?').get(id);
  const disposable=['CLOSED','IGNORED'].includes(row.state)&&!row.incident_entity_id;
  if(this.db.prepare('SELECT count(*) n FROM diag_transition WHERE fingerprint_id=?').get(id).n>=32){if(!disposable){this.addDropped(1);return;}this.db.prepare('DELETE FROM diag_transition WHERE rowid=(SELECT rowid FROM diag_transition WHERE fingerprint_id=? ORDER BY created_at,rowid LIMIT 1)').run(id);}
  if(this.count('diag_transition')>=this.limits.transitions){const victim=this.db.prepare("SELECT t.id FROM diag_transition t JOIN diag_fingerprint f ON f.id=t.fingerprint_id WHERE f.state IN('CLOSED','IGNORED') AND f.incident_entity_id IS NULL ORDER BY t.created_at,t.rowid LIMIT 1").get();if(!victim){this.addDropped(1);return;}this.db.prepare('DELETE FROM diag_transition WHERE id=?').run(victim.id);}
  this.db.prepare('INSERT INTO diag_transition VALUES(?,?,?,?,?)').run(randomUUID(),id,from,to,time);
 }

 transaction(fn){const deadline=Date.now()+this.maxRetryMs;for(;;){try{this.db.exec('BEGIN IMMEDIATE');break;}catch(error){if(error.errcode!==5||Date.now()>=deadline)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10+Math.floor(Math.random()*40));}}try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 record(input={},context={},importId=null){const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);context={projectId:context.projectId??null,operationId:context.operationId?(uuid(context.operationId)?context.operationId:randomUUID()):null,traceId:uuid(context.traceId)?context.traceId:null,parentOperationId:uuid(context.parentOperationId)?context.parentOperationId:null};if(importId&&!/^[a-f0-9-]{36,64}$/.test(importId))throw Error('Invalid import identity');const m=safeMetadata(input),projectId=context.projectId??null,id=fingerprint({...m,projectId}),time=Date.now();return this.transaction(()=>{
  if(importId){if(this.db.prepare('SELECT id FROM diag_import WHERE id=?').get(importId))return {id,duplicate:true};if(this.count('diag_import')>=this.limits.imports)throw Object.assign(new Error('Import identity budget reached; no tombstones discarded'),{code:'HERMIT_DIAGNOSTICS_UNAVAILABLE'});this.db.prepare('INSERT INTO diag_import VALUES(?,?)').run(importId,time);}
  const previous=this.db.prepare('SELECT state FROM diag_fingerprint WHERE id=?').get(id);const regressed=['VERIFIED_FIXED','CLOSED'].includes(previous?.state);if(!previous&&this.count('diag_fingerprint')>=this.limits.fingerprints){this.bucket(m,false,time,projectId);this.addDropped(1);return {id,aggregateOnly:true,diagnosticsDegraded:true};}
  this.db.prepare(`INSERT INTO diag_fingerprint(id,project_id,code,component,phase,category,state,first_seen,last_seen,total) VALUES(?,?,?,?,?,?,'NEW',?,?,1) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,total=total+1,state=CASE WHEN state IN('VERIFIED_FIXED','CLOSED') THEN 'REGRESSED' ELSE state END,regressions=regressions+CASE WHEN state IN('VERIFIED_FIXED','CLOSED') THEN 1 ELSE 0 END,verified=CASE WHEN state IN('VERIFIED_FIXED','CLOSED') THEN 0 ELSE verified END`).run(id,projectId,m.code,m.component,m.phase,m.category,time,time);
  if(regressed)this.transitionSample(id,previous.state,'REGRESSED',time);
  this.bucket(m,false,time,projectId);
  if(m.category!=='expected'){
   if(this.count('diag_occurrence')<this.limits.occurrences)this.db.prepare('INSERT INTO diag_occurrence VALUES(?,?,?,?)').run(randomUUID(),id,time,m.durationMs);else this.addDropped(1);
   // Preserve first, latest, slowest, first regression and a uniform min-hash sample.
   const samples=this.db.prepare('SELECT * FROM diag_occurrence WHERE fingerprint_id=? ORDER BY created_at,rowid').all(id);
   const keep=new Set();const retain=row=>{if(row)keep.add(row.id);};retain(samples[0]);retain(samples.at(-1));retain([...samples].sort((a,b)=>b.duration_ms-a.duration_ms)[0]);
   const regression=this.db.prepare("SELECT min(created_at) time FROM diag_transition WHERE fingerprint_id=? AND to_state='REGRESSED'").get(id)?.time;
   if(regression!==null&&regression!==undefined)retain(samples.find(row=>row.created_at>=regression));retain([...samples].sort((a,b)=>a.id.localeCompare(b.id))[0]);
   for(const row of [...samples].reverse())if(keep.size<5)retain(row);
   for(const row of samples)if(!keep.has(row.id))this.db.prepare('DELETE FROM diag_occurrence WHERE id=?').run(row.id);

   if(context.operationId&&this.count('diag_operation')<this.limits.operations)this.db.prepare('INSERT OR IGNORE INTO diag_operation VALUES(?,?,?,?,?,?,?,?)').run(context.operationId,context.traceId??context.operationId,context.parentOperationId??null,({expected:'FAILED_EXPECTED',timeout:'TIMED_OUT',cancelled:'CANCELLED',dependency:'FAILED_DEPENDENCY'})[m.category]??'FAILED_INTERNAL',m.category==='timeout'?'PENDING_AFTER_TIMEOUT':'NONE',time,m.durationMs,id);
  }
  return {id,duplicate:false};
 });}
 bucket(m,success,time=Date.now(),projectId=null){if(!this.db.prepare('SELECT scope FROM diag_total WHERE scope=?').get(projectId??'')&&this.count('diag_total')>=this.limits.totals){projectId=null;this.addDropped(1);}if(!this.db.prepare('SELECT 1 FROM diag_bucket WHERE day=? AND scope=? AND component=?').get(Math.floor(time/86400000),projectId??'',m.component)&&this.count('diag_bucket')>=this.limits.buckets)this.db.prepare('DELETE FROM diag_bucket WHERE rowid IN(SELECT rowid FROM diag_bucket ORDER BY day LIMIT 1)').run();this.db.prepare('INSERT INTO diag_bucket VALUES(?,?,?,?,?,?) ON CONFLICT(day,scope,component) DO UPDATE SET successes=successes+excluded.successes,failures=failures+excluded.failures,duration_ms=duration_ms+excluded.duration_ms').run(Math.floor(time/86400000),projectId??'',m.component,success?1:0,success?0:1,m.durationMs);this.db.prepare('INSERT INTO diag_total VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET successes=successes+excluded.successes,failures=failures+excluded.failures').run(projectId??'',success?1:0,success?0:1);}
 success(metadata,context={}){return this.transaction(()=>this.bucket(safeMetadata(metadata),true,Date.now(),context.projectId??null));}
 list({limit=100,state,component,projectId=null}={}){return this.db.prepare('SELECT * FROM diag_fingerprint WHERE project_id IS ? AND (? IS NULL OR state=?) AND (? IS NULL OR component=?) ORDER BY last_seen DESC,id LIMIT ?').all(projectId,state??null,state??null,component??null,component??null,Math.max(1,Math.min(5000,Number(limit)||100)));}
 show(id,{projectId=null}={}){return this.db.prepare('SELECT * FROM diag_fingerprint WHERE id=? AND project_id IS ?').get(id,projectId)??null;}
 samples(id,scope={}){if(!this.show(id,scope))return [];return this.db.prepare('SELECT * FROM diag_occurrence WHERE fingerprint_id=? ORDER BY created_at').all(id);}
 operations(){return this.db.prepare('SELECT * FROM diag_operation ORDER BY created_at').all();}
 late(id,state){if(!['LATE_SUCCEEDED','LATE_FAILED','LATE_CANCELLED'].includes(state))throw Error('Invalid late state');this.db.prepare("UPDATE diag_operation SET late_state=? WHERE id=? AND state='TIMED_OUT' AND late_state='PENDING_AFTER_TIMEOUT'").run(state,id);}
 transition(id,to,{verified=false,projectId=null}={}){return this.transaction(()=>{const row=this.show(id,{projectId});assertTransition(row?.state,to);if(to==='VERIFIED_FIXED'&&!verified)throw Error('Explicit passing verification required');this.db.prepare('UPDATE diag_fingerprint SET state=?,verified=? WHERE id=?').run(to,to==='VERIFIED_FIXED'?1:0,id);this.transitionSample(id,row.state,to,Date.now());return this.show(id,{projectId});});}
 summary({projectId=null}={}){const row=this.db.prepare('SELECT successes,failures FROM diag_total WHERE scope=?').get(projectId??'')??{successes:0,failures:0};return {...row,dropped:this.db.prepare("SELECT value FROM diag_meta WHERE key='dropped'").get()?.value??0,fingerprints:this.db.prepare('SELECT count(*) n FROM diag_fingerprint WHERE project_id IS ?').get(projectId).n};}
 addDropped(count){this.db.prepare("INSERT INTO diag_meta VALUES('dropped',?) ON CONFLICT(key) DO UPDATE SET value=value+excluded.value").run(count);}
 session(id,close=false){if(!/^[a-f0-9-]{32,64}$/.test(id))throw Error('Invalid safe session id');const time=Date.now();if(!this.db.prepare('SELECT id FROM diag_session WHERE id=?').get(id)&&this.count('diag_session')>=this.limits.sessions)throw Error('Session budget reached');this.db.prepare("INSERT INTO diag_session VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,heartbeat_at=excluded.heartbeat_at").run(id,close?'CLOSED':'ACTIVE',time,time);}
}
