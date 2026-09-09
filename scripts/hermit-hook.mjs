#!/usr/bin/env node
import {reportCliFailure} from './lib/diagnostics/cli-failure.mjs';
import {enterProcessContext,currentContext} from './lib/diagnostics/context.mjs';
enterProcessContext();
let store;
try{
 const {readFileSync,existsSync}=await import('node:fs');
 const {resolvePaths}=await import('./lib/storage/paths.mjs');
 const {BrainStore}=await import('./lib/storage/brain-store.mjs');
 const {resolveProject}=await import('./lib/storage/project-resolver.mjs');
 const {SessionService}=await import('./lib/runtime/session-service.mjs');
 const raw=readFileSync(0,'utf8');if(Buffer.byteLength(raw)>1048576)throw new Error('input too large');const input=JSON.parse(raw);const paths=resolvePaths();let result;
 if(input.op==='paths')result={dbPath:paths.dbPath};
 else if(['session-start','session-end'].includes(input.op)&&!input.upstreamSessionId)result={degraded:true,sessionLifecycle:'degraded',code:'HERMIT_STABLE_SESSION_REQUIRED'};
 else{
  if(!['graph','capture','session-start','session-end','session-list'].includes(input.op)||typeof input.cwd!=='string'||!input.cwd)throw new Error('invalid operation');
  currentContext().operation=input.op;
  const readOnly=['graph','session-list'].includes(input.op);
  if(readOnly&&!existsSync(paths.dbPath))result=input.op==='graph'?{entities:[],relations:[]}:[];
  else{
   store=new BrainStore({dbPath:paths.dbPath,readOnly});const project=resolveProject(store,{rootPath:input.cwd,create:['capture','session-start'].includes(input.op)});
   currentContext().projectId=project?.id??null;
   if(project&&input.upstreamSessionId&&input.agent){const sessions=new SessionService({store});currentContext().sessionId=sessions.lookup({projectId:project.id,agent:input.agent,upstreamSessionId:input.upstreamSessionId})?.sessionId??null;}
   if(input.op.startsWith('session-')){const sessions=new SessionService({store});const data={projectId:project?.id,agent:input.agent,upstreamSessionId:input.upstreamSessionId};result=input.op==='session-list'?(project?sessions.list(data):[]):project?(input.op==='session-start'?sessions.start(data):sessions.end(data)):null;}
   else if(input.op==='graph'){
    const entities=project?store.listEntities({projectId:project.id,includeGlobal:input.includeGlobal===true,lifecycles:input.includeCandidates?['active','candidate']:['active']}):[];
    const ids=new Set(entities.map(e=>e.id));result={project,entities,relations:store.listRelations().filter(r=>ids.has(r.fromEntityId)&&ids.has(r.toEntityId))};
   }else{
    if(!Array.isArray(input.entities)||input.entities.length>100)throw new Error('invalid capture');
    const count=store.batch(()=>{let n=0;for(const e of input.entities){if(store.getEntity({name:e.name,projectId:project.id,lifecycles:['active','candidate','archived','rejected']}))continue;store.createEntity({name:e.name,entityType:e.entityType,observations:e.observations,lifecycle:'candidate',projectId:project.id,provenance:{source:'hook'}});n++;}return n;});result={count};
   }
  }
 }
 process.stdout.write(JSON.stringify(result));
}catch(error){reportCliFailure(error,{component:'hook'});process.exitCode=1;}finally{store?.close();}
