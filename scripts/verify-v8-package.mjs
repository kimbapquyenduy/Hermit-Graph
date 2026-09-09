import {readFileSync,mkdtempSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,execSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'hermit-pack-gate-'));
try{
 const env={...process.env,npm_config_cache:join(temp,'npm-cache')};
 const info=JSON.parse(execSync('npm pack --json --ignore-scripts',{cwd:root,env,encoding:'utf8',maxBuffer:4*1024*1024}))[0];
 const archive=join(root,info.filename);
 try{
  const paths=new Set(info.files.map(f=>f.path));
  for(const file of ['scripts/brain-cli.mjs','scripts/hermit-mcp-server.mjs','scripts/hermit-mcp-v8.mjs','scripts/setup-v8.mjs','scripts/maintenance-cli.mjs','scripts/diagnostics-cli.mjs','scripts/memory-cli.mjs','scripts/scan-cli.mjs','scripts/code-index-cli.mjs','viewer/index.html'])assert.ok(paths.has(file),'Missing packaged entrypoint: '+file);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync('package.json','utf8')).bin),['hermit']);
  for(const file of info.files){assert.ok(!/(^|\/)(\.env|brain\.db|brain\.jsonl|\.agents|\.codex)(\/|$)/.test(file.path),'Private file packaged: '+file.path);const bytes=readFileSync(join(root,file.path),'utf8');assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|HERMIT_PRIVATE_CANARY_[A-Za-z0-9]+|sk-proj-[A-Za-z0-9_-]{40,}/.test(bytes),'Secret/canary content in '+file.path);}
  execFileSync('tar',['-xf',archive,'-C',temp]);const extracted=join(temp,'package');symlinkSync(join(root,'node_modules'),join(extracted,'node_modules'),process.platform==='win32'?'junction':'dir');
  execFileSync(process.execPath,[join(root,'scripts/package-smoke.mjs'),extracted],{cwd:root,stdio:'inherit',timeout:120000});
  console.log(JSON.stringify({packageFiles:paths.size,contentScan:true,extractedPackageSmoke:true}));
 }finally{if(existsSync(archive))rmSync(archive);}
}finally{rmSync(temp,{recursive:true,force:true});}
