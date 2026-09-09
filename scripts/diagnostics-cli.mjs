#!/usr/bin/env node
import {reportCliFailure} from './lib/diagnostics/cli-failure.mjs';
import {readFileSync} from 'node:fs';
import {openRuntime} from './lib/v8-cli-runtime.mjs';
import {DiagnosticsStore} from './lib/diagnostics/store.mjs';
import {doctorCommand} from './lib/diagnostics/cli.mjs';
let runtime,store;
try{
 const [command='summary',...args]=process.argv.slice(2),options={};let id;
 const booleans={'--preview':'preview','--samples':'samples','--dry-run':'dryRun','--apply':'apply','--passed':'passed','--runtime':'runtime'};
 const values={'--state':'state','--evidence':'evidence','--out':'out','--root':'root'};
 for(let i=0;i<args.length;i++){const arg=args[i];if(booleans[arg])options[booleans[arg]]=true;else if(values[arg]){if(!args[i+1]||args[i+1].startsWith('--'))throw Error('argument');options[values[arg]]=args[++i];}else if(arg==='--confirm-file'){if(!args[i+1])throw Error('argument');Object.assign(options,JSON.parse(readFileSync(args[++i],'utf8')));}else if(arg==='--json'){}else if(!arg.startsWith('-')&&!id)id=arg;else throw Error('argument');}
 runtime=openRuntime({readOnly:!['mark','verify','promote','prune','import-sessions'].includes(command)});
 store=new DiagnosticsStore({brainStore:runtime.store});
 const result=await doctorCommand({store,brainStore:runtime.store,command,id,projectId:options.runtime?null:runtime.scope.projectId,options});console.log(JSON.stringify(result,null,2));
}catch(error){reportCliFailure(error,{component:'diagnostics'});process.exitCode=1;}finally{store?.close();runtime?.store.close();}
