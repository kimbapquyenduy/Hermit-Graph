#!/usr/bin/env node
import {readFileSync,existsSync} from 'node:fs';
import {resolvePaths} from './lib/storage/paths.mjs';
import {BrainStore} from './lib/storage/brain-store.mjs';
import {resolveProject} from './lib/storage/project-resolver.mjs';
let store;
try{
 const raw=readFileSync(0,'utf8');if(Buffer.byteLength(raw)>1048576)throw new Error('input too large');const input=JSON.parse(raw);
 const paths=resolvePaths();let result;
 if(input.op==='paths')result={dbPath:paths.dbPath};
 else{
  if(!['graph','capture'].includes(input.op)||typeof input.cwd!=='string'||!input.cwd)throw new Error('invalid operation');
  if(input.op==='graph'&&!existsSync(paths.dbPath))result={entities:[],relations:[]};
  else{
   store=new BrainStore({dbPath:paths.dbPath,readOnly:input.op==='graph'});
   const project=resolveProject(store,{rootPath:input.cwd,create:input.op==='capture'});
   if(input.op==='graph'){
    const entities=project?store.listEntities({projectId:project.id,includeGlobal:input.includeGlobal===true,lifecycles:input.includeCandidates?['active','candidate']:['active']}):[];
    const ids=new Set(entities.map(e=>e.id));result={project,entities,relations:store.listRelations().filter(r=>ids.has(r.fromEntityId)&&ids.has(r.toEntityId))};
   }else{
    if(!Array.isArray(input.entities)||input.entities.length>100)throw new Error('invalid capture');
    const count=store.batch(()=>{let n=0;for(const e of input.entities){if(store.getEntity({name:e.name,projectId:project.id,lifecycles:['active','candidate','archived','rejected']}))continue;store.createEntity({name:e.name,entityType:e.entityType,observations:e.observations,lifecycle:'candidate',projectId:project.id,provenance:{source:'hook'}});n++;}return n;});result={count};
   }
  }
 }
 process.stdout.write(JSON.stringify(result));
}catch{process.stderr.write('HERMIT_HOOK_FAILED\n');process.exitCode=1;}finally{store?.close();}
