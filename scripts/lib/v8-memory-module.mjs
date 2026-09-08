import {z} from 'zod';
const output=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
/** Register v8 memory tools against one session-scoped service. */
export function registerV8Memory(server,service){
 const tool=(name,description,schema,fn)=>server.tool(name,description,schema,async args=>{try{return output(await fn(args));}catch(error){const code=/^HERMIT_[A-Z_]+$/.test(error.code||'')?error.code:'HERMIT_ERROR';let diagnosticId;try{diagnosticId=service.store.recordDiagnostic({projectId:service.projectId??null,code,component:'memory'}).id;}catch{}return {...output({code,diagnosticId,message:'Memory operation failed; inspect scoped diagnostics.'}),isError:true};}});
 tool('hermit_session_start','Select the current project and recall context.',{cwd:z.string(),query:z.string().optional()},({cwd,query})=>({project:service.startSession(cwd),entities:query?service.search(query):service.readGraph().entities}));
 tool('hermit_search_nodes','Search active memory in the current project and global scope.',{query:z.string(),includeGlobal:z.boolean().optional(),includeArchived:z.boolean().optional()},a=>service.search(a.query,a));
 tool('hermit_open_nodes','Read entities by stable ID or name within current scope.',{names:z.array(z.string()),includeGlobal:z.boolean().optional(),includeArchived:z.boolean().optional()},a=>service.openNodes(a.names,a));
 tool('hermit_read_graph','Read current scoped graph.',{includeGlobal:z.boolean().optional()},a=>service.readGraph(a));
 tool('hermit_create_entities','Create or extend entities in the current project.',{entities:z.array(z.object({name:z.string(),entityType:z.string(),observations:z.array(z.string()),lifecycle:z.enum(['active','candidate']).optional()}))},a=>service.createEntities(a.entities));
 tool('hermit_add_observations','Add observations using a scoped stable entity ID.',{entityId:z.string(),observations:z.array(z.string())},a=>service.addObservations(a.entityId,a.observations));
 tool('hermit_create_relations','Link stable entity IDs in the current project.',{relations:z.array(z.object({fromEntityId:z.string(),toEntityId:z.string(),relationType:z.string()}))},a=>service.store.batch(()=>a.relations.map(r=>service.createRelation(r.fromEntityId,r.toEntityId,r.relationType))));
 tool('hermit_archive_entities','Archive entities without deleting history.',{ids:z.array(z.string()),reason:z.string().optional()},a=>service.store.batch(()=>a.ids.map(id=>service.transition(id,'archived',a.reason))));
 tool('hermit_restore_entities','Restore archived entities.',{ids:z.array(z.string())},a=>service.store.batch(()=>a.ids.map(id=>service.transition(id,'active'))));
 tool('hermit_audit_trail','Read scoped entity history.',{entityId:z.string()},a=>service.audit(a.entityId));
 server.resource('brain-context','hermit://brain/context',async uri=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(service.readGraph())}]}));
}
