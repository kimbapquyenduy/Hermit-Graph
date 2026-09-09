#!/usr/bin/env node
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {openRuntime} from './lib/v8-cli-runtime.mjs';
import {exportKnowledge,viewerRows} from './lib/export-v8.mjs';
const require=createRequire(import.meta.url),root=dirname(dirname(fileURLToPath(import.meta.url)));
const graphology=readFileSync(join(dirname(require.resolve('graphology/package.json')),'dist','graphology.umd.min.js'),'utf8');
const sigma=readFileSync(join(dirname(require.resolve('sigma/package.json')),'build','sigma.min.js'),'utf8');
const template=readFileSync(join(root,'viewer','index.html'),'utf8').replace(/<script src="https:[^"]*graphology[^\n]*<\/script>/,()=>'<script>'+graphology+'</script>').replace(/<script src="https:[^"]*sigma[^\n]*<\/script>/,()=>'<script>'+sigma+'</script>');
const runtime=openRuntime();
function snapshot(){return exportKnowledge(runtime.store,{projectId:runtime.project?.id,includeGlobal:runtime.scope.includeGlobal,activeOnly:true});}
function page(live=false){const rows=JSON.stringify(viewerRows(snapshot()).map(x=>JSON.stringify(x)).join('\n')).replaceAll('<','\\u003c');return template.replace('<title>','<title>Read-only snapshot — ').replace('</body>',`<script>window.addEventListener('DOMContentLoaded',()=>loadBrainData(${rows}));${live?"setInterval(async()=>{try{const r=await fetch('/api/graph');if(r.ok){const s=await r.json();loadBrainData(s.rows.map(x=>JSON.stringify(x)).join('\\n'));}}catch{}},5000);":''}</script></body>`);}
if(process.argv.includes('--no-open')||process.argv.includes('--snapshot')){const dir=mkdtempSync(join(tmpdir(),'hermit-view-')),path=join(dir,'snapshot.html');writeFileSync(path,page());runtime.store.close();console.log('Read-only v8 snapshot: '+path);}
else{
 const server=createServer((req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');if(req.headers.host!==`127.0.0.1:${server.address().port}`||req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${server.address().port}`){res.writeHead(403);res.end();return;}if(req.method!=='GET'){res.writeHead(405);res.end();return;}if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page(true));}else if(req.url==='/api/graph'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({rows:viewerRows(snapshot())}));}else{res.writeHead(404);res.end();}});
 server.listen(0,'127.0.0.1',()=>{const url=`http://127.0.0.1:${server.address().port}`;console.log(url);if(process.argv.includes('--serve-only'))return;if(process.platform==='win32')spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}).unref();else spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'}).unref();});
 const stop=()=>server.close(()=>{runtime.store.close();process.exit(0);});process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
