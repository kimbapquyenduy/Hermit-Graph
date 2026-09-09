import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
export const hash=text=>text===null?null:createHash('sha256').update(text).digest('hex');
export function readOptional(path){if(!existsSync(path))return null;const bytes=readFileSync(path);try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new Error('HERMIT_CONFIG_ENCODING');}}
export function atomicWrite(path,text){mkdirSync(dirname(path),{recursive:true});const temp=join(dirname(path),'.hermit-'+randomUUID()+'.tmp');try{writeFileSync(temp,text,{flag:'wx',mode:0o600});renameSync(temp,path);}finally{if(existsSync(temp))unlinkSync(temp);}}
export function writeManifest(path,manifest){atomicWrite(path,JSON.stringify(manifest,null,2)+'\n');}
export function readManifest(path){const m=JSON.parse(readFileSync(path,'utf8'));if(m.version!==1||!Array.isArray(m.files))throw new Error('HERMIT_INVALID_SETUP_MANIFEST');for(const f of m.files){if(hash(f.before)!==f.beforeHash||hash(f.after)!==f.afterHash)throw new Error('HERMIT_INVALID_SETUP_MANIFEST');}return m;}
