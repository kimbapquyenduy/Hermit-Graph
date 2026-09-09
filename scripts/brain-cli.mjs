#!/usr/bin/env node
import {fork} from 'node:child_process';
import {enterProcessContext,childEnvironment,currentContext} from './lib/diagnostics/context.mjs';
import {reportCliFailure} from './lib/diagnostics/cli-failure.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url))),[command,...args]=process.argv.slice(2);
enterProcessContext();
const usage={setup:'setup [--agent auto|all|NAME] [--preview|--apply] [--project PATH]',uninstall:'uninstall [--agent NAME] [--preview|--apply]',serve:'serve',search:'search QUERY [--json] [--include-global]',model:'model status|install|backfill [--all]',doctor:'doctor [summary|errors|show|mark|verify|bundle|prune|promote]',status:'status',health:'health',backup:'backup create|list|verify|restore [DIRECTORY] [--apply --confirm-file FILE]',upgrade:'upgrade plan|apply|verify|rollback',reset:'reset SCOPE [--apply --confirm-file FILE]',maintenance:'maintenance status|recover',scan:'scan collect|preview|commit [RUN_ID]',review:'review list|accept|reject [ENTITY_ID]',archive:'archive ENTITY_ID',restore:'restore ENTITY_ID',export:'export [--out FILE] [--include-global|--all]',stale:'stale',view:'view [--snapshot|--no-open]',index:'index', 'check-edit':'check-edit FILE [--cwd PATH] [--format=json]',skills:'skills list|add|remove',help:'help'};
function run(script,argv=args){const child=fork(join(root,'scripts/lib/diagnostics/process-entry.mjs'),[join(root,'scripts',script),...argv],{cwd:process.env.HERMIT_USER_CWD||process.cwd(),env:childEnvironment({...process.env,HERMIT_USER_CWD:process.env.HERMIT_USER_CWD||process.cwd()}),stdio:'inherit'});child.on('error',error=>{reportCliFailure(error,{phase:'startup'});process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});}
currentContext().operation=Object.hasOwn(usage,command)?command:'unknown';
if(args.includes('--help')||command==='--help'||!command||command==='help'){console.log('Hermit v8 — local SQLite memory\n'+(usage[command]&&command!=='help'?'hermit '+usage[command]:Object.values(usage).map(u=>'hermit '+u).join('\n')));}
else if(command==='--version'||args.includes('--version'))console.log(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version);
else if(!usage[command]){reportCliFailure({code:'HERMIT_VALIDATION'});process.exitCode=1;}
else if(process.env.HERMIT_STORAGE&&process.env.HERMIT_STORAGE!=='v8'){console.error('HERMIT_LEGACY_RUNTIME_REQUIRED: use the matching older release');process.exitCode=1;}
else if(command==='serve')run('hermit-mcp-server.mjs');
else if(command==='setup'||command==='uninstall')run('setup-v8.mjs',command==='uninstall'?['uninstall',...args]:args);
else if(['upgrade','reset','maintenance'].includes(command))run('maintenance-cli.mjs',[command,...args]);
else if(command==='backup')run(['create','list','verify','restore'].includes(args[0])?'maintenance-cli.mjs':'backup-brain.mjs',['create','list','verify','restore'].includes(args[0])?[command,...args]:args);
else if(command==='model')run('semantic-cli.mjs');
else if(command==='doctor'&&args.length&&args[0]!=='--json')run('diagnostics-cli.mjs');
else if(command==='doctor'||command==='status')run('doctor.mjs');
else if(command==='view')run('view-graph.mjs');
else if(command==='health')run('brain-health.mjs');
else if(command==='check-edit')run('check-edit-cli.mjs');
else if(command==='skills')run('skills-manager.mjs');
else if(command==='scan')run('scan-cli.mjs');
else if(command==='index')run('code-index-cli.mjs');
else if(['review','archive','restore','stale','export'].includes(command))run('memory-cli.mjs',[command,...args]);
else if(command==='search'){
 let runtime;try{const {openRuntime}=await import('./lib/v8-cli-runtime.mjs');runtime=openRuntime({readOnly:!['hybrid','vector'].includes(process.env.HERMIT_SEARCH_MODE)});const query=args.filter(a=>!a.startsWith('--')).join(' ');const {ModelManager}=await import('./lib/v8-model.mjs');const mode=process.env.HERMIT_SEARCH_MODE||'lexical';const result=await new ModelManager({store:runtime.store,dataDir:runtime.paths.dataRoot}).search(query,{...runtime.scope,mode:mode==='bm25'?'lexical':mode});if(args.includes('--json'))console.log(JSON.stringify(result.entities));else{for(const e of result.entities)console.log(`${e.name} (${e.entityType})`);if(result.degraded)console.log('Lexical fallback: '+result.reason);}}catch(error){reportCliFailure(error);process.exitCode=1;}finally{runtime?.store.close();}
}
