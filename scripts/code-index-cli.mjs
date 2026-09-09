#!/usr/bin/env node
import {reportCliFailure} from './lib/diagnostics/cli-failure.mjs';
import {resolvePaths} from './lib/storage/paths.mjs';
import {ensureFreshCodeIndex,resolveCodeCache} from './lib/code-intel/code-index-service.mjs';
const root=process.env.HERMIT_USER_CWD||process.cwd();
try{const paths=resolvePaths();const cache=resolveCodeCache(root,paths.dataRoot);await ensureFreshCodeIndex(root,cache,{excludePaths:[paths.dataRoot]});console.log(JSON.stringify({indexed:true,cache}));}catch(error){reportCliFailure(error,{component:'code-index'});process.exitCode=1;}
