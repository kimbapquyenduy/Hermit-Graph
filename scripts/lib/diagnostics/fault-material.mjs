import {createHash,createHmac} from 'node:crypto';
import {safeMetadata} from './redactor.mjs';
const errorNames=new Set(['Error','TypeError','RangeError','SyntaxError','ReferenceError','URIError','EvalError','AggregateError','AbortError']);
function normalizedMessage(value){return String(value??'').slice(0,2048)
 .replace(/-----BEGIN[\s\S]*?(?:-----END[^\n]*|$)/g,'<secret>')
 .replace(/\b(?:https?|postgres(?:ql)?|mysql|mongodb|redis):\/\/\S+/gi,'<url>')
 .replace(/\b(?:password|token|secret|authorization|cookie|credential|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,'<secret>')
 .replace(/(['"`])[^'"`\n]*\1/g,'<quoted>')
 .replace(/\b[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\b/gi,'<uuid>')
 .replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?/g,'<date>')
 .replace(/(?:[A-Za-z]:[\\/]|\/(?:home|Users|tmp|var)\/)[^\s,)]+/g,'<path>')
 .replace(/\b[a-zA-Z0-9_+/=-]{24,}\b/g,'<opaque>')
 .replace(/\b\d+(?:\.\d+)?\b/g,'<number>').replace(/\s+/g,' ').trim();}
/** Only HMAC signatures and bounded package-relative frames leave this boundary. */
export function faultMaterial(error,{salt,rootPath='',operation='unknown',component='runtime',phase='request'}={}){
 const errorName=errorNames.has(error?.name)?error.name:'Error',frames=[];const root=String(rootPath).replaceAll('\\','/').replace(/\/$/,'');
 for(let line of String(error?.stack??'').slice(0,8192).split('\n').slice(1)){
  try{line=decodeURI(line);}catch{}line=line.replaceAll('\\','/');const at=root?line.toLowerCase().indexOf(root.toLowerCase()+'/'):-1;if(at<0)continue;
  const module=line.slice(at+root.length+1).replace(/:\d+(?::\d+)?\)?\s*$/,'').trim();
  const fn=line.slice(0,at).replace(/^\s*at\s+/,'').replace(/\s*\(?(?:file:\/\/\/)?$/,'').trim();
  const frame=module+(fn?'#'+fn:'');if(/^(?:scripts|catalog)\/[A-Za-z0-9_./-]+(?:#[A-Za-z0-9_$<>.[\] -]+)?$/.test(frame)&&frame.length<=200)frames.push(frame);if(frames.length===3)break;
 }
 const code=safeMetadata({code:error?.code}).code;
 const material=JSON.stringify([errorName,code,normalizedMessage(error?.message),frames]);
 const signature=Buffer.isBuffer(salt)&&salt.length===32?createHmac('sha256',salt).update(material).digest('hex'):createHash('sha256').update(JSON.stringify([errorName,code,frames])).digest('hex');
 return safeMetadata({code,component,phase,errorName,operation,signature,frames});
}
