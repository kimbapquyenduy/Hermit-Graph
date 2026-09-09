import {resolve} from 'node:path';
import {existsSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {backup,DatabaseSync} from 'node:sqlite';
import {openRuntime,userCwd} from './lib/v8-cli-runtime.mjs';
let runtime,destination,owned=false;
try{const args=process.argv.slice(2);const value=args[0]==='--to'?args[1]:args[0];if(!value)throw new Error('Usage: hermit backup <fresh-destination>');destination=resolve(userCwd(),value);runtime=openRuntime();if(existsSync(destination))throw new Error('Backup destination already exists');const fd=openSync(destination,'wx');closeSync(fd);owned=true;await backup(runtime.store.db,destination);const check=new DatabaseSync(destination,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||check.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup integrity verification failed');}finally{check.close();}owned=false;console.log(JSON.stringify({backup:destination,integrity:'ok'}));}catch(e){if(owned)unlinkSync(destination);console.error(e.message);process.exitCode=1;}finally{runtime?.store.close();}
