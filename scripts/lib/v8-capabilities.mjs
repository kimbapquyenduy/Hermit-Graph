import {traceService} from './diagnostics/operation-span.mjs';
import {ScanService} from './scan/scan-service.mjs';
import {z} from 'zod';
import {ModelManager} from './v8-model.mjs';
import {registerV8CodeTools} from './v8-code-tools.mjs';
export function registerV8Capabilities(server,service,paths){

 const model=new ModelManager({store:service.store,dataDir:paths.dataRoot});
 const result=x=>({content:[{type:'text',text:JSON.stringify(x)}]});
 const scanner=traceService(new ScanService({store:service.store}),[['collect','scan-collect','scan'],['preview','scan-preview','scan'],['commit','scan-commit','scan']]);
 server.tool('hermit_deep_scan','Collect a deterministic scan preview. Commit an inspected run explicitly; inferred knowledge remains candidate.',{cwd:z.string().optional(),action:z.enum(['collect','preview','commit']).optional(),runId:z.string().optional(),force:z.boolean().optional()},async a=>{
  if(!a.action||a.action==='collect'){const root=a.cwd||service.sessionRootPath;if(!root)throw Object.assign(new Error('Session required'),{code:'HERMIT_SESSION_REQUIRED'});return result(scanner.collect(root));}
  if(!a.runId)throw Object.assign(new Error('Run required'),{code:'HERMIT_VALIDATION'});
  const projectId=a.cwd?service.scope(a.cwd):service.projectId;
  if(!projectId||scanner.row(a.runId).project_id!==projectId)throw Object.assign(new Error('Scope required'),{code:'HERMIT_SCOPE_REQUIRED'});
  return result(a.action==='commit'?scanner.commit(a.runId):scanner.preview(a.runId));
 });
 server.tool('hermit_semantic_search','Search project memory with optional local semantic model.',{query:z.string(),mode:z.enum(['lexical','semantic','vector','hybrid']).optional(),includeGlobal:z.boolean().optional()},async a=>{
  if(service.projectId===undefined)return {...result({code:'HERMIT_SESSION_REQUIRED'}),isError:true};
  return result(await model.search(a.query,{projectId:service.projectId,includeGlobal:a.includeGlobal??false,mode:a.mode==='semantic'?'vector':a.mode??'lexical'}));
 });
 server.tool('hermit_health','Report current scoped memory and model status.',{},async()=>result({projectId:service.projectId??null,entities:service.readGraph().entities.length,integrity:service.store.integrityCheck(),model:model.status()}));
 registerV8CodeTools(server,service,paths);
}
