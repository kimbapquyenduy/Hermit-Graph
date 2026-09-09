import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync,realpathSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fullIndex,getChangedFilesByHash} from './indexer.mjs';
import {readCodeGraph,writeCodeGraph,invalidateCache} from './code-io.mjs';
import {withMaintenance} from '../maintenance/maintenance-lock.mjs';
import {ensurePythonLoaded,ensureJavaLoaded} from './parser.mjs';
const require=createRequire(import.meta.url);
const indexSignature={format:2,hermit:JSON.parse(readFileSync(new URL('../../../package.json',import.meta.url),'utf8')).version,parser:require('@ast-grep/napi/package.json').version};
const pending=new Map();
export function resolveCodeCache(root,dataRoot){let canonical=realpathSync(root);if(process.platform==='win32')canonical=canonical.toLowerCase();return join(dataRoot,'code-cache',createHash('sha256').update(canonical).digest('hex'));}
export function sourceManifest(root,{excludePaths=[]}={}){
 const {newHashes}=getChangedFilesByHash(root,{},{excludePaths,strict:true});let head=null;
 try{head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
 return {version:2,indexSignature,head,files:newHashes,digest:createHash('sha256').update(JSON.stringify([indexSignature,head,Object.entries(newHashes).sort(([a],[b])=>a.localeCompare(b))])).digest('hex')};
}
/** Rebuild in isolation and publish only a validated snapshot of unchanged sources. */
export async function ensureFreshCodeIndex(root,dataDir,{build=fullIndex,force=false,excludePaths=[]}={}){
 await Promise.all([ensurePythonLoaded(),ensureJavaLoaded()]);
 root=realpathSync(root);dataDir=resolve(dataDir);if(pending.has(dataDir))return pending.get(dataDir);
 const operation=(async()=>{mkdirSync(dataDir,{recursive:true});return withMaintenance(join(dataDir,'freshness'),async()=>{
  const options={excludePaths:[dataDir,...excludePaths],strict:true};invalidateCache();const before=sourceManifest(root,options);const previous=readCodeGraph(dataDir);
  if(!force&&previous.meta.sourceManifest?.digest===before.digest)return dataDir;
  const staging=mkdtempSync(join(dataDir,'.staging-'));
  try{
   const result=await build(root,staging,options);if(!result?.graph?.symbols||!result.graph.relations)throw new Error('HERMIT_INDEX_INVALID');
   const after=sourceManifest(root,options);if(before.digest!==after.digest)throw new Error('HERMIT_INDEX_SOURCE_CHANGED');
   const entries=result.graph.toEntries();if(!Array.isArray(entries.symbols)||!Array.isArray(entries.relations))throw new Error('HERMIT_INDEX_INVALID');
   result.graph.meta.sourceManifest=after;result.graph.meta.evidence={staticAnalysis:true,dynamicDispatch:'unknown'};
   await writeCodeGraph(dataDir,result.graph);return dataDir;
  }finally{rmSync(staging,{recursive:true,force:true});}
 });})();pending.set(dataDir,operation);try{return await operation;}finally{pending.delete(dataDir);}
}
