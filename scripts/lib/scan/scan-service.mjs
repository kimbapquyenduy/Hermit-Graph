import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join,relative,resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {resolveProject,resolveProjectRoot} from '../storage/project-resolver.mjs';
import {scanProject,buildEntities} from '../project-learner.mjs';
const excluded=new Set(['.git','.hermit','node_modules','dist','build','coverage','.next','.venv','vendor']);
export function scanManifest(root,{excludePaths=[]}={}){const ignored=new Set(excludePaths.map(p=>resolve(p)));const files={};let count=0;
 const walk=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(excluded.has(entry.name))continue;const p=join(dir,entry.name);if(ignored.has(resolve(p)))continue;if(entry.isSymbolicLink())continue;if(entry.isDirectory())walk(p);else if(entry.isFile()){if(++count>20000||statSync(p).size>20*1024*1024)throw Object.assign(new Error('Scan input exceeds explicit collection limit'),{code:'HERMIT_SCAN_LIMIT'});files[relative(root,p).replace(/\\/g,'/')]=createHash('sha256').update(readFileSync(p)).digest('hex');}}};walk(root);return {files,digest:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
export class ScanService{
 constructor({store}){this.store=store;}
 manifest(root){return scanManifest(root,{excludePaths:[dirname(this.store.dbPath)]});}
 collect(root,{inferred=[]}={}){
  root=resolveProjectRoot(root);const project=resolveProject(this.store,{rootPath:root,create:true});const before=this.manifest(root);const {tech,biz}=buildEntities(scanProject(root));
  const drafts=[tech,biz].map(e=>({...e,lifecycle:'active',provenance:{source:'deterministic-scan',digest:before.digest,files:Object.keys(before.files).filter(p=>/package\.json|pyproject\.toml|Cargo\.toml|go\.mod/.test(p))}}));
  for(const e of inferred)drafts.push({...e,lifecycle:'candidate',provenance:{source:'inferred-scan',digest:before.digest}});
  if(this.manifest(root).digest!==before.digest)fail('HERMIT_SCAN_STALE','Sources changed during collection');
  const id=randomUUID();this.store.db.prepare('INSERT INTO scan_runs VALUES(?,?,?,?,?,?,?,NULL)').run(id,project.id,root,before.digest,JSON.stringify({drafts,manifest:before}), 'COLLECTED',new Date().toISOString());return {id,projectId:project.id,...this.preview(id)};
 }
 row(id){const row=this.store.db.prepare('SELECT * FROM scan_runs WHERE id=?').get(id);if(!row)fail('HERMIT_SCAN_NOT_FOUND','Scan not found');return row;}
 preview(id){const row=this.row(id),payload=JSON.parse(row.payload);let created=0,updated=0;const conflicts=[];
  for(const e of payload.drafts){const old=this.store.getEntity({name:e.name,projectId:row.project_id,lifecycles:['active','candidate','archived','rejected']});if(!old)created++;else if(!['deterministic-scan','inferred-scan'].includes(old.provenance.source)||old.entityType!==e.entityType||old.lifecycle!==e.lifecycle||old.observations.some(o=>!['deterministic-scan','inferred-scan'].includes(o.provenance.source)))conflicts.push(e.name);else if(JSON.stringify(old.observations.map(o=>o.content))!==JSON.stringify(e.observations))updated++;}
  return {id,projectId:row.project_id,state:row.state,created,updated,archived:0,conflicts,digest:row.digest};
 }
 commit(id){return this.store.batch(()=>{const row=this.row(id),payload=JSON.parse(row.payload);if(row.state==='COMMITTED')return {...payload.receipt,idempotent:true};if(this.manifest(row.root_path).digest!==row.digest)fail('HERMIT_SCAN_STALE','Sources changed; collect again');const receipt=this.preview(id);if(receipt.conflicts.length)fail('HERMIT_SCAN_CONFLICT','Reviewed knowledge would be overwritten');
  for(const draft of payload.drafts){const old=this.store.getEntity({name:draft.name,projectId:row.project_id,lifecycles:['active','candidate','archived','rejected']});if(old&&old.lifecycle!==draft.lifecycle)fail('HERMIT_SCAN_CONFLICT','Lifecycle changed since source collection');if(old)for(const obs of old.observations)if(!draft.observations.includes(obs.content))this.store.transitionObservation({id:obs.id,to:'archived'});const {entity}=this.store.createEntity({...draft,projectId:row.project_id});this.store.db.prepare('UPDATE entities SET provenance=?,updated_at=? WHERE id=?').run(JSON.stringify(draft.provenance),new Date().toISOString(),entity.id);for(const content of draft.observations){const observation=this.store.db.prepare('SELECT id,lifecycle FROM observations WHERE entity_id=? AND content=?').get(entity.id,content);if(observation.lifecycle!=='active')this.store.transitionObservation({id:observation.id,to:'active'});this.store.db.prepare('UPDATE observations SET provenance=? WHERE id=?').run(JSON.stringify(draft.provenance),observation.id);}}
  payload.receipt={...receipt,state:'COMMITTED',idempotent:false};this.store.db.prepare("UPDATE scan_runs SET state='COMMITTED',payload=?,committed_at=? WHERE id=?").run(JSON.stringify(payload),new Date().toISOString(),id);return payload.receipt;
 });}
}
