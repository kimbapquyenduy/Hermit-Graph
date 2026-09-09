import {createReadStream,lstatSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
// One bounded streaming pass computes content identity and safe failing line numbers.
// Paths, transcript text and nested payloads never enter the diagnostics store.
export async function importSessions({root,store,projectId=null,days=30,maxFiles=100,maxBytes=50*1024*1024,maxFileBytes=5*1024*1024,maxLineBytes=16384}={}){
 const report={imported:0,duplicates:0,oversized:0,malformed:0,files:0,limited:false};let totalBytes=0;const queue=[root];let directories=0;
 while(queue.length&&report.files<maxFiles&&directories<100){const directory=queue.shift();if(lstatSync(directory).isSymbolicLink())throw Error('Session import does not follow symlinks');directories++;
  for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory()){queue.push(path);continue;}if(!entry.isFile()||!entry.name.endsWith('.jsonl'))continue;const stat=lstatSync(path);if(stat.mtimeMs<Date.now()-days*86400000)continue;if(stat.size>maxFileBytes||totalBytes+stat.size>maxBytes||report.files>=maxFiles){report.limited=true;continue;}totalBytes+=stat.size;report.files++;
   const hash=createHash('sha256'),failures=[];let bytes=0;let pending=Buffer.alloc(0),skipping=false,line=0;
   const consume=buffer=>{line++;if(skipping){report.oversized++;skipping=false;return;}if(!buffer.length)return;let value;try{value=JSON.parse(buffer.toString('utf8'));}catch{report.malformed++;return;}const failure=value?.isError===true||value?.is_error===true||value?.type==='error'||(Array.isArray(value?.message?.content)&&value.message.content.some(item=>item?.type==='tool_result'&&item?.is_error===true));if(!failure)return;if(failures.length<5000)failures.push(line);else report.limited=true;};
   bytes=0;for await(const chunk of createReadStream(path)){hash.update(chunk);bytes+=chunk.length;if(bytes>maxFileBytes)throw Error('Session file grew beyond budget');let start=0;for(let i=0;i<chunk.length;i++){if(chunk[i]!==10)continue;const part=chunk.subarray(start,i);if(!skipping&&pending.length+part.length<=maxLineBytes)pending=Buffer.concat([pending,part]);else skipping=true;consume(pending);pending=Buffer.alloc(0);start=i+1;}const part=chunk.subarray(start);if(!skipping&&pending.length+part.length<=maxLineBytes)pending=Buffer.concat([pending,part]);else{skipping=true;pending=Buffer.alloc(0);}}if(pending.length||skipping)consume(pending);const fileId=hash.digest('hex');for(const lineNumber of failures){const id=createHash('sha256').update(`${fileId}:${lineNumber}`).digest('hex');try{const result=store.record({code:'HERMIT_TOOL_ERROR',component:'diagnostics',phase:'import',category:'dependency'},{projectId},id);if(result.duplicate)report.duplicates++;else report.imported++;}catch(error){if(error.code==='HERMIT_DIAGNOSTICS_UNAVAILABLE'){report.limited=true;break;}throw error;}}
  }
 }
 if(queue.length)report.limited=true;return report;
}
