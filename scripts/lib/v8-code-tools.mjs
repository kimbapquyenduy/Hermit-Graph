import {withOperation} from './diagnostics/operation-span.mjs';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {z} from 'zod';
import {join} from 'node:path';
import {ensureFreshCodeIndex,sourceManifest,resolveCodeCache} from './code-intel/code-index-service.mjs';
import {readCodeGraph} from './code-intel/code-io.mjs';
import {blastRadius,symbolContext} from './code-intel/impact.mjs';
const normalizeFilePath=value=>String(value||'').replace(/\\/g,'/').replace(/^\.\//,'').replace(/:\d+(-\d+)?$/,'').toLowerCase();
const parseFilesObservation=text=>/^FILES?:\s*/i.test(text)?text.replace(/^FILES?:\s*/i,'').split(/[,\s]+/).map(normalizeFilePath):[];
export function registerV8CodeTools(server,service,paths){
 const output=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
 const cwd=a=>a.cwd||service.sessionRootPath;
 const cache=root=>resolveCodeCache(root,paths.dataRoot);
 const run=(name,description,schema,fn)=>server.tool(name,description,schema,async a=>{const root=cwd(a);if(!root)return {...output({code:'HERMIT_SESSION_REQUIRED'}),isError:true};const data=cache(root);await withOperation('code-index','code-index',()=>ensureFreshCodeIndex(root,data,{force:name==='hermit_index',excludePaths:[paths.dataRoot]}));return output(await withOperation(name,'code-index',()=>fn(a,root,data)));});
 run('hermit_query','Search current working-tree code by name/text; no model required.',{query:z.string(),cwd:z.string().optional()},(a,r,d)=>({symbols:readCodeGraph(d).searchSymbols(a.query).slice(0,20),evidence:'static; dynamic dispatch may be unknown'}));
 run('hermit_context','Read symbol callers and callees from a fresh working-tree snapshot.',{name:z.string(),cwd:z.string().optional()},(a,r,d)=>symbolContext(readCodeGraph(d),a.name));
 run('hermit_impact','Compute fresh static impact and scoped SQLite business references. Dynamic edges remain unknown.',{target:z.string(),direction:z.enum(['upstream','downstream','both']).optional(),cwd:z.string().optional(),verbose:z.boolean().optional()},(a,root,d)=>{
  const impact=blastRadius(readCodeGraph(d),a.target,a.direction||'upstream');const files=new Set([impact.target,...impact.d1||[],...impact.d2||[],...impact.d3||[]].filter(Boolean).map(s=>normalizeFilePath(s.file)));
  const references=service.readGraph({cwd:root}).entities.filter(e=>['biz-rule','biz-flow','incident-bug'].includes(e.entityType)).filter(e=>e.observations.some(o=>parseFilesObservation(o.content.replace(/^\[[^\]]+\]\s*/,'' )).some(f=>files.has(f))));
  return { ...impact,businessReferences:references,evidence:{source:'static AST',dynamicDispatch:'unknown'}};
 });
 run('hermit_index','Build a verified code snapshot; preserve last good on failure.',{cwd:z.string().optional()},(a,r,d)=>({indexed:readCodeGraph(d).meta}));
 server.tool('hermit_detect_changes','Read content freshness including untracked/edited/deleted files.',{cwd:z.string().optional()},async a=>{const root=cwd(a);if(!root)return {...output({code:'HERMIT_SESSION_REQUIRED'}),isError:true};const manifest=sourceManifest(root,{excludePaths:[paths.dataRoot]});const indexed=readCodeGraph(cache(root)).meta.sourceManifest;return output({stale:indexed?.digest!==manifest.digest,manifest,indexed:indexed??null});});
}
