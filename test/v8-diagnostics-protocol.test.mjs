import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {z} from 'zod';
import {BrainStore} from '../scripts/lib/storage/brain-store.mjs';
import {DiagnosticsStore,DIAGNOSTICS_SCHEMA_SQL} from '../scripts/lib/diagnostics/store.mjs';
import {Recorder} from '../scripts/lib/diagnostics/recorder.mjs';
import {instrumentServer} from '../scripts/lib/diagnostics/instrument-server.mjs';
test('actual MCP input validation, unknown tools, throws and returned errors capture once without secrets',async t=>{const root=mkdtempSync(join(tmpdir(),'hermit-protocol-'));const brain=new BrainStore({dbPath:join(root,'brain.db')});brain.db.exec(DIAGNOSTICS_SCHEMA_SQL);const store=new DiagnosticsStore({brainStore:brain}),recorder=new Recorder({store});const server=new McpServer({name:'fixture',version:'1'});instrumentServer(server,{recorder});server.tool('failure','test',{value:z.number()},async()=>{throw Error('SENTINEL_PRIVATE_PASSWORD');});server.tool('returned','test',{},async()=>({isError:true,content:[{type:'text',text:'SENTINEL_PRIVATE_PASSWORD'}]}));const client=new Client({name:'fixture',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();t.after(async()=>{await client.close();await server.close();store.close();brain.close();rmSync(root,{recursive:true,force:true});});await server.connect(a);await client.connect(b);for(const args of [{name:'failure',arguments:{value:'SENTINEL_PRIVATE_PASSWORD'}},{name:'failure',arguments:{value:1}},{name:'returned',arguments:{}},{name:'SENTINEL_PRIVATE_PASSWORD',arguments:{}}]){const result=await client.callTool(args);assert.equal(result.isError,true);assert.ok(!JSON.stringify(result).includes('SENTINEL_PRIVATE_PASSWORD'));}assert.equal(store.summary().failures,4);assert.equal(store.operations().length,2);assert.equal(store.list().filter(r=>r.category==='expected').reduce((sum,r)=>sum+r.total,0),2);});

test('child failure is recorded once with session linkage and a usable correlation reference',async t=>{
 const root=mkdtempSync(join(tmpdir(),'hermit-child-span-')),brain=new BrainStore({dbPath:join(root,'brain.db')}),store=new DiagnosticsStore({brainStore:brain}),recorder=new Recorder({store});
 const {traceService}=await import('../scripts/lib/diagnostics/operation-span.mjs');const service=traceService({load(message){throw new TypeError(message);}},[['load','storage-load','storage']]);const sessionId='11111111-1111-7111-8111-111111111111';store.session(sessionId);
 const server=new McpServer({name:'fixture',version:'1'});instrumentServer(server,{recorder,sessionId,faultOptions:{salt:store.faultSalt(),rootPath:process.cwd()}});server.tool('hermit_failure','test',{message:z.string()},a=>service.load(a.message));
 const client=new Client({name:'fixture',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();t.after(async()=>{await client.close();await server.close();store.close();brain.close();rmSync(root,{recursive:true,force:true});});await server.connect(a);await client.connect(b);
 for(const message of ['Source parser failed','Database connection refused']){const result=await client.callTool({name:'hermit_failure',arguments:{message}});assert.equal(result.isError,true);const error=JSON.parse(result.content[0].text).error;assert.ok(!JSON.stringify(result).includes(message));const row=store.show(error.correlationId);assert.equal(row.id,error.diagnosticRef);assert.equal(row.operation,'storage-load');}
 assert.equal(store.summary().failures,2);assert.equal(store.list().length,2);for(const operation of store.operations()){assert.equal(operation.session_id,sessionId);assert.ok(operation.parent_id);assert.notEqual(operation.id,operation.parent_id);}
});
