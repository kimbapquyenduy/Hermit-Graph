import {register as registerDeepScan} from './deep-scan-module.mjs';
import {z} from 'zod';
import {ModelManager} from './v8-model.mjs';
import {register as registerCodegraph} from './codegraph-module.mjs';
export function registerV8Capabilities(server,service,paths){
 registerDeepScan(server,{store:service.store,memoryService:service,log:()=>{}});
 const model=new ModelManager({store:service.store,dataDir:paths.dataRoot});
 const result=x=>({content:[{type:'text',text:JSON.stringify(x)}]});
 server.tool('hermit_semantic_search','Search project memory with optional local semantic model.',{query:z.string(),mode:z.enum(['lexical','semantic','vector','hybrid']).optional(),includeGlobal:z.boolean().optional()},async a=>{
  if(service.projectId===undefined)return {...result({code:'HERMIT_SESSION_REQUIRED'}),isError:true};
  return result(await model.search(a.query,{projectId:service.projectId,includeGlobal:a.includeGlobal??false,mode:a.mode==='semantic'?'vector':a.mode??'lexical'}));
 });
 server.tool('hermit_health','Report current scoped memory and model status.',{},async()=>result({projectId:service.projectId??null,entities:service.readGraph().entities.length,integrity:service.store.integrityCheck(),model:model.status()}));
 // Force code tools to use the chosen session if cwd is omitted.
 const scoped={tool(name,description,schema,...rest){const handler=rest.pop();return server.tool(name,name==='hermit_query'?'Search indexed code symbols by name or literal text. Uses the selected project code index.':description,schema,...rest,async a=>{
  const cwd=a.cwd||service.sessionRootPath||service.store.getProject(service.projectId)?.rootPath;
  if(!cwd)return {...result({code:'HERMIT_SESSION_REQUIRED'}),isError:true};
  return handler({...a,cwd});
 });}};
 registerCodegraph(scoped,{lexicalOnly:true,log:message=>process.stderr.write(`[hermit] ${message}\n`)});
}
