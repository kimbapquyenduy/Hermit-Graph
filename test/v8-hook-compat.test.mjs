import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {BrainStore} from '../scripts/lib/storage/brain-store.mjs';
import {MemoryService} from '../scripts/lib/memory-service.mjs';
const require=createRequire(import.meta.url);
test('legacy hook APIs recall SQLite scoped active entities and capture candidates only',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v8-hooks-'));const previous={...process.env};let store;
 try{const cwd=join(dir,'project');mkdirSync(cwd);Object.assign(process.env,{HERMIT_DATA_DIR:join(dir,'data'),HERMIT_PACKAGE_ROOT:resolve('.'),HERMIT_USER_CWD:cwd});store=new BrainStore({dbPath:join(dir,'data','brain.db')});const svc=new MemoryService({store});svc.startSession(cwd);svc.createEntities([{name:'TECH:Scoped',entityType:'tech-stack',observations:['sqlite needle']}]);writeFileSync(join(dir,'legacy.jsonl'),JSON.stringify({type:'entity',name:'TECH:Leak',entityType:'tech-stack',observations:['sqlite needle']}));process.env.MEMORY_FILE_PATH=join(dir,'legacy.jsonl');
 const recall=require('../catalog/hooks/lib/recall-core.cjs');const extractor=require('../catalog/hooks/lib/entity-extractor.cjs');const results=recall.searchBrain(['needle'],[]);assert.deepEqual(results.map(e=>e.name),['TECH:Scoped']);assert.equal(extractor.appendToBrain([{name:'TECH:Captured',entityType:'tech-stack',observations:['candidate needle']}],recall.resolveBrainPath()),1);assert.equal(store.listEntities({projectId:svc.projectId,lifecycles:['candidate']})[0].name,'TECH:Captured');assert.equal(recall.searchBrain(['candidate'],[]).length,0);
 }finally{store?.close();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);rmSync(dir,{recursive:true,force:true});}
});
