import {resolveProject,resolveProjectRoot} from './storage/project-resolver.mjs';
const allStates=['active','candidate','archived','rejected'];
/** Scoped application boundary: never allow an entity ID to bypass project access. */
export class MemoryService {
 constructor({store}) {this.store=store;this.projectId=undefined;this.sessionRootPath=undefined;}
 scope(cwd,{create=false}={}) {
  if(!cwd)return this.projectId;
  return resolveProject(this.store,{rootPath:cwd,create})?.id;
 }
 startSession(cwd){if(!cwd)throw Object.assign(new Error('A project root is required'),{code:'HERMIT_SESSION_REQUIRED'});const sessionRootPath=resolveProjectRoot(cwd);const project=resolveProject(this.store,{rootPath:sessionRootPath,create:true});this.projectId=project.id;this.sessionRootPath=sessionRootPath;return project;}
 readGraph({cwd,includeGlobal=false,includeArchived=false}={}){
  const projectId=this.scope(cwd);if(projectId===undefined)return {entities:[],relations:[]};
  const entities=this.store.listEntities({projectId,includeGlobal,lifecycles:includeArchived?['active','archived']:['active']});
  const ids=new Set(entities.map(e=>e.id));
  return {entities,relations:this.store.listRelations().filter(r=>ids.has(r.fromEntityId)&&ids.has(r.toEntityId))};
 }
 openNodes(names,options={}){const wanted=new Set(names);return this.readGraph(options).entities.filter(e=>wanted.has(e.id)||wanted.has(e.name));}
 search(query,{cwd,includeGlobal=false,includeArchived=false,topK=20}={}){
  const projectId=this.scope(cwd);if(projectId===undefined)return [];
  return this.store.search(query,{projectId,includeGlobal,includeArchived,topK});
 }
 createEntities(entities){if(this.projectId===undefined)throw Object.assign(new Error('Start a project session before writing memory'),{code:'HERMIT_SESSION_REQUIRED'});return this.store.batch(()=>entities.map(e=>this.store.createEntity({...e,projectId:this.projectId})));}
 writable(id){const e=this.store.getEntity({id,lifecycles:allStates});if(!e||e.projectId!==this.projectId)throw Object.assign(new Error('Entity not found in current project'),{code:'HERMIT_NOT_FOUND'});return e;}
 addObservations(id,contents){this.writable(id);return this.store.batch(()=>contents.map(content=>this.store.addObservation({entityId:id,content})));}
 createRelation(fromEntityId,toEntityId,relationType){this.writable(fromEntityId);this.writable(toEntityId);return this.store.createRelation({fromEntityId,toEntityId,relationType});}
 transition(id,to,reason=''){this.writable(id);return this.store.transitionEntity({id,to,reason,actor:'user'});}
 audit(id){this.writable(id);return this.store.listChangeEvents({entityId:id});}
}
