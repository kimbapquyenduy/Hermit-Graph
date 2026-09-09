import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--test','--test-concurrency=1','test/sqlite-bm25-search.test.mjs','test/vector-backend-latency.test.mjs','test/mcp-bridge-integration.test.mjs'],{env:{...process.env,HERMIT_PERFORMANCE_GATES:'1'},stdio:'inherit',timeout:180000});
if(result.error)throw result.error;process.exitCode=result.status??1;
