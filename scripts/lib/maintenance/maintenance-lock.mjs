import {mkdirSync,existsSync,realpathSync,lstatSync,writeFileSync,readFileSync,readdirSync,unlinkSync,rmdirSync,renameSync} from 'node:fs';
import {resolve,dirname,join,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {hostname} from 'node:os';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const heldLocks=new WeakMap();
export function assertMaintenanceLock(lock,dbPath){if(heldLocks.get(lock)!==canonicalTarget(dbPath))fail('HERMIT_MAINTENANCE_REQUIRED','A live exclusive maintenance token is required');}
export function canonicalTarget(value){
 const absolute=resolve(value);let cursor=absolute;
 while(!existsSync(cursor)){const next=dirname(cursor);if(next===cursor)break;cursor=next;}
 let walk=cursor;while(dirname(walk)!==walk){if(lstatSync(walk).isSymbolicLink())fail('HERMIT_UNSAFE_PATH','Symbolic links and junctions are not maintenance targets');walk=dirname(walk);}
 const suffix=absolute.slice(cursor.length);return realpathSync(cursor)+suffix;
}
function paths(dbPath){const target=canonicalTarget(dbPath);return {target,dir:canonicalTarget(join(dirname(target),`.${basename(target)}.leases`)),lock:canonicalTarget(join(dirname(target),`.${basename(target)}.maintenance`))};}
function dead(record){if(record.host!==hostname()||!Number.isInteger(record.pid)||record.pid<=0)return false;try{process.kill(record.pid,0);return false;}catch(e){return e.code==='ESRCH';}}
function identity(version){return {id:randomUUID(),pid:process.pid,host:hostname(),version:String(version),createdAt:new Date().toISOString()};}
function read(file){try{return JSON.parse(readFileSync(file,'utf8'));}catch{return {};}}
// Publishing the exclusive directory before scanning leases closes the admission race.
export function acquireRuntimeLease(dbPath,{version='8.2'}={}){
 const p=paths(dbPath);mkdirSync(p.dir,{recursive:true});
 if(existsSync(p.lock))fail('HERMIT_MAINTENANCE_ACTIVE','Maintenance must finish before opening the brain');
 const record=identity(version),file=join(p.dir,`${record.id}.json`);writeFileSync(file,JSON.stringify(record),{flag:'wx'});
 if(existsSync(p.lock)){unlinkSync(file);fail('HERMIT_MAINTENANCE_ACTIVE','Maintenance acquired admission while runtime was starting');}
 let released=false;return {record,release(){if(!released){unlinkSync(file);released=true;}}};
}
export function acquireMaintenanceLock(dbPath,{version='8.2'}={}){
 const p=paths(dbPath);mkdirSync(dirname(p.lock),{recursive:true});
 try{mkdirSync(p.lock);}catch(e){if(e.code==='EEXIST')fail('HERMIT_MAINTENANCE_ACTIVE','Another maintenance owner exists; inspect its owner record before recovery');throw e;}
 const record=identity(version);writeFileSync(join(p.lock,'owner.json'),JSON.stringify(record),{flag:'wx'});
 const evidence=[];let released=false;
 let token;const release=()=>{if(!released){unlinkSync(join(p.lock,'owner.json'));rmdirSync(p.lock);released=true;if(token)heldLocks.delete(token);}};
 try{const stale=[];if(existsSync(p.dir))for(const name of readdirSync(p.dir)){const file=canonicalTarget(join(p.dir,name)),lease=read(file);if(!dead(lease))fail(lease.version&&lease.version!==String(version)?'HERMIT_MIXED_RUNTIME':'HERMIT_RUNTIME_ACTIVE','All runtime processes must close before maintenance');evidence.push({id:lease.id,pid:lease.pid,reason:'local PID does not exist',recoveredAt:new Date().toISOString()});stale.push(file);}for(const file of stale)unlinkSync(file);
 token={record,evidence,release};heldLocks.set(token,p.target);return token;}catch(e){release();throw e;}
}
export function recoverMaintenanceLock(dbPath){
 const p=paths(dbPath),owner=read(join(p.lock,'owner.json'));
 if(!dead(owner))fail('HERMIT_STALE_PROOF_REQUIRED','Cannot prove maintenance owner is dead');
 const recovery=join(p.lock,'recovery');try{mkdirSync(recovery);}catch{fail('HERMIT_RECOVERY_ACTIVE','Another recovery is active');}if(read(join(p.lock,'owner.json')).id!==owner.id){rmdirSync(recovery);fail('HERMIT_STALE_PROOF_REQUIRED','Maintenance owner changed');}
 const journal=canonicalTarget(`${p.target}.swap-recovery.json`);
 if(existsSync(journal)){const swap=read(journal);if(swap.target!==p.target||typeof swap.previous!=='string'||!swap.previous.startsWith(`${p.target}.rollback-`)||dirname(swap.previous)!==dirname(p.target))fail('HERMIT_RECOVERY_INVALID','Invalid database swap recovery journal');canonicalTarget(swap.previous);if(existsSync(swap.previous)){if(createHash('sha256').update(readFileSync(swap.previous)).digest('hex')!==swap.sha256)fail('HERMIT_RECOVERY_INVALID','Previous database hash changed');if(existsSync(p.target))renameSync(p.target,`${p.target}.failed-${randomUUID()}`);renameSync(swap.previous,p.target);}else if(!existsSync(p.target))fail('HERMIT_RECOVERY_INVALID','Neither original nor replacement database exists');unlinkSync(journal);}
 // Recovery is deliberately explicit; an empty/unpublished lock cannot be guessed stale.
 unlinkSync(join(p.lock,'owner.json'));rmdirSync(recovery);rmdirSync(p.lock);return {pid:owner.pid,reason:'local PID does not exist'};
}
export function maintenanceStatus(dbPath){const p=paths(dbPath);return {dbPath:p.target,maintenance:existsSync(p.lock)?{...read(join(p.lock,'owner.json')),provablyDead:dead(read(join(p.lock,'owner.json')))}:null,leases:existsSync(p.dir)?readdirSync(p.dir).map(name=>{const record=read(canonicalTarget(join(p.dir,name)));return {...record,provablyDead:dead(record)};}):[],interruptedSwap:existsSync(`${p.target}.swap-recovery.json`)};}
export async function withMaintenance(dbPath,fn,options){const lock=acquireMaintenanceLock(dbPath,options);try{if(lock.evidence.length&&existsSync(dbPath)){const db=new DatabaseSync(dbPath);try{if(db.prepare("SELECT name FROM sqlite_master WHERE name='diag_events'").get())db.prepare('INSERT INTO diag_events VALUES(?,?,?,?,?,?,NULL)').run(randomUUID(),null,'HERMIT_STALE_LEASE_RECOVERED','storage','open',new Date().toISOString());}finally{db.close();}}return await fn(lock);}finally{lock.release();}}
