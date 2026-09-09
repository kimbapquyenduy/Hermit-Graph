import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const packageRoot=resolve(process.argv[2]||'.'),root=mkdtempSync(join(tmpdir(),'hermit-package-smoke-')),cwd=join(root,'project');mkdirSync(cwd);
writeFileSync(join(cwd,'package.json'),JSON.stringify({name:'smoke-project'}));writeFileSync(join(cwd,'app.js'),'export function entry(){return helper();} export function helper(){return 1;}');
const client=new Client({name:'package-smoke',version:'1'}),called=new Set();
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[join(packageRoot,'scripts/hermit-mcp-server.mjs')],cwd,env:{...process.env,HERMIT_DATA_DIR:join(root,'data'),HERMIT_DB_PATH:'',HERMIT_STORAGE:'v8',HERMIT_PROJECT_CWD:cwd,HERMIT_USER_CWD:cwd},stderr:'pipe'}));
 const tools=(await client.listTools()).tools;
 async function call(name,args={}){const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify({name,result}));called.add(name);return JSON.parse(result.content[0].text);}
 await call('hermit_session_start',{cwd});
 const created=await call('hermit_create_entities',{entities:[{name:'PATTERN:Smoke',entityType:'pattern-code',observations:['WHAT: packaged smoke']},{name:'BIZ:Smoke',entityType:'biz-domain',observations:['WHAT: isolated test']}]});const id=created[0].entity.id,domain=created[1].entity.id;
 await call('hermit_add_observations',{entityId:id,observations:['HOW: real protocol']});await call('hermit_create_relations',{relations:[{fromEntityId:id,toEntityId:domain,relationType:'used_in'}]});
 await call('hermit_search_nodes',{query:'packaged'});await call('hermit_open_nodes',{names:[id]});await call('hermit_read_graph');await call('hermit_audit_trail',{entityId:id});await call('hermit_archive_entities',{ids:[id]});await call('hermit_restore_entities',{ids:[id]});
 const scan=await call('hermit_deep_scan',{cwd});await call('hermit_deep_scan',{action:'preview',runId:scan.id});await call('hermit_deep_scan',{action:'commit',runId:scan.id});
 await call('hermit_semantic_search',{query:'packaged'});await call('hermit_health');await call('hermit_index',{cwd});await call('hermit_query',{query:'entry'});await call('hermit_context',{name:'entry'});await call('hermit_impact',{target:'helper'});await call('hermit_detect_changes');
 const invalid=await client.callTool({name:'hermit_search_nodes',arguments:{query:123}});assert.equal(invalid.isError,true);
 await call('hermit_diagnostics_summary');const errors=await call('hermit_diagnostics_list');assert.ok(errors.length);await call('hermit_diagnostics_show',{id:errors[0].id});await call('hermit_diagnostics_incident_draft',{id:errors[0].id});
 await client.readResource({uri:'hermit://brain/context'});
 assert.deepEqual(tools.map(t=>t.name).filter(name=>!called.has(name)),[],'Every advertised tool needs a smoke invocation');console.log(JSON.stringify({packageRoot,tools:called.size,resource:true,passed:true}));
}finally{await client.close();rmSync(root,{recursive:true,force:true});}
