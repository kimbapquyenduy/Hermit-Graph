import {realpathSync,existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,basename,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
const canonical=value=>process.platform==='win32'?value.toLowerCase():value;
function conflict(){throw Object.assign(new Error('Project identity evidence conflicts'),{code:'HERMIT_PROJECT_ID_CONFLICT'});}
export function resolveProjectRoot(rootPath) {
 const root=realpathSync(resolve(rootPath));
 try{return realpathSync(execFileSync('git',['-C',root,'rev-parse','--show-toplevel'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());}catch{return root;}
}
/** Read resolution is side-effect free. create:true is the explicit registration boundary. */
export function resolveProject(store,{rootPath,projectId,name,create=false}={}) {
 if(!rootPath){if(projectId){const p=store.getProject(projectId);if(p)return p;conflict();}return null;}
 let root=realpathSync(resolve(rootPath));let common=null;
 try{
  root=realpathSync(execFileSync('git',['-C',root,'rev-parse','--show-toplevel'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());
  common=realpathSync(resolve(root,execFileSync('git',['-C',root,'rev-parse','--git-common-dir'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()));
 }catch{}
 const alias=canonical(root),marker=common?join(common,'hermit-project-id'):join(root,'.hermit','project-id');
 const known=store.resolveProjectAlias({aliasType:'path',aliasValue:alias});
 const commonKnown=common?store.resolveProjectAlias({aliasType:'git-common-dir',aliasValue:canonical(common)}):null;
 let markerId=null;
 if(existsSync(marker)){markerId=readFileSync(marker,'utf8').trim();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(markerId))conflict();}
 const evidence=[projectId,markerId,known?.id,commonKnown?.id].filter(Boolean);
 if(new Set(evidence).size>1)conflict();
 let selected=evidence.length?store.getProject(evidence[0]):null;
 if(evidence.length&&!selected)conflict();
 if(!create)return selected;
 return store.batch(()=>{
  selected=selected||store.createProject({name:name||basename(root),rootPath:root});
  // Never replace a marker; concurrent registration must agree or roll back.
  if(!markerId){mkdirSync(dirname(marker),{recursive:true});try{writeFileSync(marker,selected.id+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;if(readFileSync(marker,'utf8').trim()!==selected.id)conflict();}}
  for(const [type,value] of [['path',alias],...(common?[['git-common-dir',canonical(common)]]:[])]){
   const previous=store.resolveProjectAlias({aliasType:type,aliasValue:value});if(previous&&previous.id!==selected.id)conflict();
   store.db.prepare('INSERT OR IGNORE INTO project_aliases(alias_type,alias_value,project_id) VALUES(?,?,?)').run(type,value,selected.id);
  }
  return selected;
 });
}
