import {homedir} from 'node:os';
import {resolve,join,isAbsolute,dirname,basename} from 'node:path';
import {existsSync,realpathSync} from 'node:fs';
function realResolve(path){if(existsSync(path))return realpathSync(path);const parent=dirname(path);return parent===path?path:join(realResolve(parent),basename(path));}
export function resolvePaths({env=process.env,platform=process.platform,home=homedir()}={}) {
 if(env.HERMIT_DATA_DIR&&!isAbsolute(env.HERMIT_DATA_DIR))throw Object.assign(new Error('HERMIT_DATA_DIR must be absolute'),{code:'HERMIT_INVALID_DATA_ROOT'});
 const fallback=platform==='win32'?join(env.LOCALAPPDATA||join(home,'AppData','Local'),'HermitGraph'):platform==='darwin'?join(home,'Library','Application Support','HermitGraph'):join(env.XDG_DATA_HOME||join(home,'.local','share'),'hermit-graph');
 const dataRoot=realResolve(resolve(env.HERMIT_DATA_DIR||fallback));
 if(env.HERMIT_DB_PATH&&!isAbsolute(env.HERMIT_DB_PATH))throw Object.assign(new Error('HERMIT_DB_PATH must be absolute'),{code:'HERMIT_INVALID_DATA_ROOT'});
 return {dataRoot,dataDir:dataRoot,dbPath:env.HERMIT_DB_PATH?realResolve(env.HERMIT_DB_PATH):join(dataRoot,'brain.db'),modelsDir:join(dataRoot,'models'),backupsDir:join(dataRoot,'backups'),crashSpoolDir:join(dataRoot,'crash-spool')};
}
