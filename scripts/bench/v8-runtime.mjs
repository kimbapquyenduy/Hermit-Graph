import {performance} from 'node:perf_hooks';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir,cpus} from 'node:os';
import {join} from 'node:path';
import {BrainStore} from '../lib/storage/brain-store.mjs';
import {DiagnosticsStore} from '../lib/diagnostics/store.mjs';
import {Recorder} from '../lib/diagnostics/recorder.mjs';
const root=mkdtempSync(join(tmpdir(),'hermit-v8-bench-')),brain=new BrainStore({dbPath:join(root,'brain.db')}),store=new DiagnosticsStore({brainStore:brain}),recorder=new Recorder({store});
function measure(fn){const raw=[];for(let i=0;i<550;i++){const start=performance.now();fn();if(i>=50)raw.push(performance.now()-start);}const sorted=[...raw].sort((a,b)=>a-b);return {p50:sorted[249],p95:sorted[474],raw};}
try{const success=measure(()=>recorder.success({component:'mcp'})),error=measure(()=>recorder.capture({code:'HERMIT_TEST_FAILURE',component:'mcp'}));const report={date:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,samples:500,success,error,gate:success.p95<=2&&error.p95<=5,limitsMs:{successP95:2,errorP95:5},competitors:'NOT_TESTED'};if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({...report,success:{p50:success.p50,p95:success.p95},error:{p50:error.p50,p95:error.p95}}));if(!report.gate)process.exitCode=1;}finally{store.close();brain.close();rmSync(root,{recursive:true,force:true});}
