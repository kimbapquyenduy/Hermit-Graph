import { BrainStore } from './storage/brain-store.mjs';
import {enterProcessContext,currentContext} from './diagnostics/context.mjs';
import { resolvePaths } from './storage/paths.mjs';
import { resolveProject } from './storage/project-resolver.mjs';
export const userCwd=()=>process.env.HERMIT_USER_CWD||process.cwd();
export function openRuntime({includeGlobal=process.argv.includes('--include-global'),readOnly=true}={}){
 enterProcessContext();
 const paths=resolvePaths({env:process.env});
 const store=new BrainStore({dbPath:paths.dbPath,readOnly});
 let project;try{project=resolveProject(store,{rootPath:userCwd(),create:false});}catch(error){store.close();throw error;}
 currentContext().projectId=project?.id??null;
 return {store,paths,project,scope:{projectId:project?.id??'__hermit_unresolved_project__',includeGlobal}};
}
export function graphSnapshot(r){
 const entities=r.store.listEntities(r.scope).map(e=>({...e,type:'entity',observations:e.observations.map(o=>typeof o==='string'?o:o.content)}));
 const ids=new Set(entities.map(e=>e.id));
 const relations=r.store.listRelations().map(e=>({...e,type:'relation',from:e.fromEntityId,to:e.toEntityId})).filter(e=>ids.has(e.from)&&ids.has(e.to));
 return {entities,relations};
}
