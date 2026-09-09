import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
test('MCP writes persist across restart without JSONL and scopes IDs',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'hermit-mcp8-'));const a=join(dir,'a'),b=join(dir,'b');mkdirSync(a);mkdirSync(b);
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 async function connect(){const client=new Client({name:'test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('scripts/hermit-mcp-v8.mjs')],env:{...process.env,HERMIT_DATA_DIR:join(dir,'data'),HERMIT_PROJECT_CWD:a},stderr:'pipe'}));return client;}
 let client=await connect();const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
 try{
  const created=await call('hermit_create_entities',{entities:[{name:'TECH:Shared',entityType:'tech-stack',observations:['alpha','omega']}]});
  const id=created[0].entity.id;
  const scanned=await client.callTool({name:'hermit_deep_scan',arguments:{cwd:a,force:true}});assert.ok(!scanned.isError,JSON.stringify(scanned));assert.equal(JSON.parse(scanned.content[0].text).state,'COLLECTED');
  await call('hermit_create_entities',{entities:[{name:'TECH:Inferred',entityType:'tech-stack',observations:['scanner inference'],lifecycle:'candidate'}]});assert.equal((await call('hermit_open_nodes',{names:['TECH:Inferred']})).length,0);
  await call('hermit_session_start',{cwd:b});assert.equal((await call('hermit_open_nodes',{names:[id]})).length,0);
  await client.close();client=await connect();assert.equal((await call('hermit_search_nodes',{query:'alpha omega'}))[0].id,id);
  await call('hermit_archive_entities',{ids:[id]});assert.equal((await call('hermit_open_nodes',{names:[id]})).length,0);
  assert.equal((await call('hermit_open_nodes',{names:[id],includeArchived:true})).length,1);
  assert.equal(existsSync(join(dir,'data','brain.jsonl')),false);
 }finally{await client.close();}
});
