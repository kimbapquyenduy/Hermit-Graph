#!/usr/bin/env node
import {reportCliFailure} from './lib/diagnostics/cli-failure.mjs';
import {BrainStore} from './lib/storage/brain-store.mjs';import {resolvePaths} from './lib/storage/paths.mjs';import {ScanService} from './lib/scan/scan-service.mjs';
const [command='collect',id]=process.argv.slice(2);let store;try{store=new BrainStore({dbPath:resolvePaths().dbPath});const service=new ScanService({store});const result=command==='collect'?service.collect(process.env.HERMIT_USER_CWD||process.cwd()):command==='preview'?service.preview(id):command==='commit'?service.commit(id):(()=>{throw new Error('HERMIT_SCAN_ARGUMENT');})();console.log(JSON.stringify(result,null,2));}catch(e){reportCliFailure(e,{component:'scan'});process.exitCode=1;}finally{store?.close();}
