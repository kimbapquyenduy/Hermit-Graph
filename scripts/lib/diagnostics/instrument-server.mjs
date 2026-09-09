import {z} from 'zod';
import { performance } from 'node:perf_hooks';
import { withContext,currentContext } from './context.mjs';
import { safeErrorEnvelope } from './redactor.mjs';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const WRAPPED=Symbol('diagnostics-wrapped');
function mcpError(reference,code){const structuredContent=safeErrorEnvelope({code,...reference});return {isError:true,structuredContent,content:[{type:'text',text:JSON.stringify(structuredContent)}]};}
export function instrumentHandler(handler,{recorder,tool,component='mcp',timeoutMs=0,safeErrors=false,projectId=null,isExpectedInput=()=>false}={}) {
 if(handler[WRAPPED])return handler;
 const wrapped=function(...args){return withContext(async()=>{const context={...currentContext(),projectId:typeof projectId==='function'?projectId():projectId},start=performance.now();let timedOut=false,timer;const work=Promise.resolve().then(()=>handler.apply(this,args));
  work.then(result=>{if(timedOut)recorder.late(context.operationId,result?.isError?'LATE_FAILED':'LATE_SUCCEEDED');},()=>{if(timedOut)recorder.late(context.operationId,'LATE_FAILED');});
  try{const result=await (timeoutMs>0?Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(Object.assign(new Error('Operation timed out'),{code:'HERMIT_TIMEOUT'}));},timeoutMs);})]):work);const metadata={component,durationMs:performance.now()-start};if(result?.isError){const expected=isExpectedInput(args[0]),code=expected?'HERMIT_VALIDATION':'HERMIT_TOOL_ERROR';const reference=recorder.capture({...metadata,code,category:expected?'expected':'internal'},context);if(safeErrors)return mcpError(reference,code);}else recorder.success(metadata,context);return result;}
  catch(error){const reference=recorder.capture({component,code:timedOut?'HERMIT_TIMEOUT':error?.code,category:timedOut?'timeout':error?.name==='AbortError'?'cancelled':'internal',durationMs:performance.now()-start},context);if(safeErrors)return mcpError(reference,timedOut?'HERMIT_TIMEOUT':error?.code);try{if(error&&typeof error==='object')Object.assign(error,{correlationId:reference.correlationId,diagnosticsDegraded:reference.diagnosticsDegraded});}catch{}throw error;}
  finally{clearTimeout(timer);}
 });};wrapped[WRAPPED]=true;return wrapped;
}
// Wrap the registration seam once, covering both legacy tool() and registerTool().
export function instrumentServer(server,options){if(server[WRAPPED])return server;server[WRAPPED]=true;
 // MCP's input/output validation and returned errors are inside this handler.
 // Instrument here rather than double-wrapping tool() -> registerTool().
 if(server.server?.setRequestHandler){const validators=new Map(),register=server.tool;server.tool=function(...args){validators.set(args[0],z.object(args[2]??{}));return register.apply(this,args);};instrumentMcpProtocol(server.server,{...options,isExpectedInput:request=>{const schema=validators.get(request?.params?.name);return !schema||!schema.safeParse(request?.params?.arguments??{}).success;}});return server;}
 for(const method of ['tool','registerTool']){if(typeof server[method]!=='function')continue;const original=server[method];server[method]=function(...args){const last=args.length-1;if(typeof args[last]==='function')args[last]=instrumentHandler(args[last],{...options,tool:args[0]});return original.apply(this,args);};}return server;}
export function instrumentMcpProtocol(server,options){if(server[WRAPPED])return server;server[WRAPPED]=true;const original=server.setRequestHandler;server.setRequestHandler=function(schema,handler){return original.call(this,schema,schema===CallToolRequestSchema?instrumentHandler(handler,{safeErrors:true,...options}):handler);};return server;}
