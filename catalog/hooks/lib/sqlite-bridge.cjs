'use strict';
const {existsSync,readFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {spawnSync}=require('node:child_process');
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
 const result=spawnSync(process.execPath,[resolveHookScript()],{input:JSON.stringify({...request,cwd}),encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024,windowsHide:true});
 let value;try{value=JSON.parse(result.stdout||'');}catch{}
 if(result.error||result.status!==0||!value||value.ok===false)throw Object.assign(new Error('Hermit SQLite hook operation failed'),{code:value?.error?.code||'HERMIT_HOOK_BRIDGE_FAILED'});
 return value;
}
function readGraph(options={}){return invoke({op:'graph',...options});}
module.exports={invoke,readGraph,resolveHookScript};
