'use strict';
const {existsSync,readFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {spawnSync}=require('node:child_process');
const {randomBytes}=require('node:crypto');
let hookContext={};
function uuid(){const b=randomBytes(16);b.writeUIntBE(Date.now(),0,6);b[6]=(b[6]&15)|112;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
function bindHookContext(payload,agent){hookContext={agent,upstreamSessionId:typeof payload.session_id==='string'?payload.session_id:undefined};}
const context={traceId:uuid(),operationId:uuid()};
function resolveHookScript(){
 const candidates=[process.env.HERMIT_PACKAGE_ROOT&&join(process.env.HERMIT_PACKAGE_ROOT,'scripts','hermit-hook.mjs'),resolve(__dirname,'../../../scripts/hermit-hook.mjs')];
 try{const config=JSON.parse(readFileSync(join(__dirname,'hermit-runtime.json'),'utf8'));if(config.packageRoot)candidates.push(join(config.packageRoot,'scripts','hermit-hook.mjs'));}catch{}
 try{candidates.push(require.resolve('hermit-graph/scripts/hermit-hook.mjs'));}catch{}
 const found=candidates.find(p=>p&&existsSync(p));
 if(!found)throw Object.assign(new Error('Set HERMIT_PACKAGE_ROOT to the installed Hermit package for copied hooks'),{code:'HERMIT_HOOK_PACKAGE_MISSING'});
 return found;
}
function invoke(request){
 const cwd=request.cwd||process.env.CWD||process.env.HERMIT_USER_CWD||process.env.CLAUDE_PROJECT_DIR||process.cwd();
 const result=spawnSync(process.execPath,[resolveHookScript()],{input:JSON.stringify({...hookContext,...request,cwd}),env:{...process.env,HERMIT_DIAGNOSTIC_CONTEXT:JSON.stringify(context)},encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024,windowsHide:true});
 let value;try{value=JSON.parse(result.stdout||'');}catch{}
 if(result.error||result.status!==0||!value||value.ok===false){let failure=value?.error;for(const line of (result.stderr||'').split('\n'))try{failure=JSON.parse(line).error??failure;}catch{}const correlationId=/^[a-f0-9-]{36}$/.test(failure?.correlationId)?failure.correlationId:context.operationId;throw Object.assign(new Error('Hermit SQLite hook operation failed; correlationId='+correlationId),{code:failure?.code||'HERMIT_HOOK_BRIDGE_FAILED',correlationId,diagnosticsDegraded:failure?.diagnosticsDegraded??true});}
 return value;
}
function readGraph(options={}){return invoke({op:'graph',...options});}
function reportHookFailure(error){if(!error?.correlationId)try{invoke({op:'failure'});}catch(captured){error=captured;}const correlationId=/^[a-f0-9-]{36}$/.test(error?.correlationId)?error.correlationId:context.operationId;process.stderr.write(JSON.stringify({ok:false,error:{code:'HERMIT_HOOK_BRIDGE_FAILED',correlationId,diagnosticsDegraded:error?.diagnosticsDegraded??true}})+'\n');}
module.exports={invoke,readGraph,resolveHookScript,bindHookContext,reportHookFailure};
