import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const manifest=JSON.parse(readFileSync('test/test-manifest.json','utf8')).files;
const discovered=[];function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const path=join(dir,e.name).replaceAll('\\','/');if(e.isDirectory())walk(path);else if(/\.test\.(mjs|ts)$/.test(path))discovered.push(path);}}walk('test');if(existsSync('tests'))walk('tests');
for(const path of discovered)if(!manifest[path])throw Error('Unclassified test: '+path);
for(const [path,entry] of Object.entries(manifest)){if(entry.optional&&entry.kind!=='template')throw Error('Only local templates can be optional: '+path);if(!discovered.includes(path)&&!entry.optional)throw Error('Stale manifest entry: '+path);}
for(const [path,entry] of Object.entries(manifest))if(entry.kind!=='node-test'){if(!['benchmark','template'].includes(entry.kind)||!entry.reason)throw Error('Invalid classification: '+path);console.log(entry.kind+': '+path+' — '+entry.reason);}
const tests=discovered.filter(p=>manifest[p].kind==='node-test').sort();
if(process.argv.includes('--list')){console.log(JSON.stringify(tests));process.exit(0);}
for(const args of [['scripts/test-v4.mjs'],['--test','--test-concurrency=1','--test-timeout=120000',...tests],['scripts/test-e2e-code-intel.mjs'],['scripts/verify-hook-scanner-authority.mjs'],['scripts/verify-v8-contract.mjs'],['scripts/verify-v8-package.mjs']]){
 const result=spawnSync(process.execPath,args,{stdio:'inherit',timeout:600000});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
}
console.log('Canonical validation passed: legacy, classified Node tests, E2E, authority and extracted package smoke.');
