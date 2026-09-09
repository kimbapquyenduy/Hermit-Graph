import {resolve,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {enterProcessContext,currentContext} from './context.mjs';
import {reportCliFailure} from './cli-failure.mjs';
enterProcessContext();
let failed=false;
function fatal(error){if(failed)return;failed=true;reportCliFailure(error,{component:'cli',phase:'startup'});process.exitCode=1;setTimeout(()=>process.exit(1),10).unref();}
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
const target=process.argv[2];process.argv.splice(1,2,target);
currentContext().operation=basename(target,'.mjs');
const processContext=currentContext();
process.on('exit',code=>{if(code!==0&&!failed&&!processContext.failureReported)reportCliFailure({code:'HERMIT_RUNTIME_ERROR'},{persist:basename(target)!=='doctor.mjs'});});
// Best-effort scope binding must never initialize storage or prevent setup/doctor.
try{const {openRuntime}=await import('../v8-cli-runtime.mjs');const runtime=openRuntime({readOnly:true});runtime.store.close();}catch{}
try{await import(pathToFileURL(resolve(target)).href);}catch(error){fatal(error);}
