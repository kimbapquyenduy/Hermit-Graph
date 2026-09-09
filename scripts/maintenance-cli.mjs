#!/usr/bin/env node
import {reportCliFailure} from './lib/diagnostics/cli-failure.mjs';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {resolvePaths} from './lib/storage/paths.mjs';
import {createBackup,listBackups,verifyBackup,previewRestore,restoreBackup} from './lib/maintenance/backup-service.mjs';
import {upgradePlan,applyUpgrade,verifyUpgrade} from './lib/maintenance/upgrade-service.mjs';
import {previewReset,applyReset} from './lib/maintenance/reset-service.mjs';
import {maintenanceStatus,recoverMaintenanceLock} from './lib/maintenance/maintenance-lock.mjs';
const [command,action,...args]=process.argv.slice(2);
const values=new Map(),positional=[];let parseError;for(let i=0;i<args.length;i++){const arg=args[i];if(['--confirm-file','--confirm'].includes(arg)){if(values.has(arg)||!args[i+1]||args[i+1].startsWith('--')){parseError='Missing or duplicate '+arg;break;}values.set(arg,args[++i]);}else if(['--preview','--apply','--json'].includes(arg)){if(values.has(arg)){parseError='Duplicate '+arg;break;}values.set(arg,true);}else if(arg.startsWith('--')){parseError='Unknown option '+arg;break;}else positional.push(arg);}const option=name=>values.get(name);
const confirmation=()=>option('--confirm-file')?JSON.stringify(JSON.parse(readFileSync(option('--confirm-file'),'utf8'))):option('--confirm');
const paths=resolvePaths();
try{
 if(parseError||values.has('--apply')&&values.has('--preview')||values.has('--confirm')&&values.has('--confirm-file'))throw Object.assign(new Error(parseError||'Conflicting options'),{code:'HERMIT_VALIDATION'});
 let result;
 if(command==='maintenance'){if(positional.length)throw new Error('Unexpected argument');const status=maintenanceStatus(paths.dbPath);if(action==='status')result=status;else if(action==='recover'){const plan={operation:'recover-maintenance',...status};if(values.has('--apply')){if(confirmation()!==JSON.stringify(plan))throw Object.assign(new Error('Confirm exact recovery preview JSON'),{code:'HERMIT_CONFIRMATION_REQUIRED'});result=recoverMaintenanceLock(paths.dbPath);}else result=plan;}else throw new Error('Use maintenance status/recover');
 }else if(command==='backup'){
  const directory=positional[0];if(positional.length>1)throw new Error('Unexpected backup argument');
  if(action==='create')result=await createBackup(paths.dbPath,directory||join(paths.backupsDir,randomUUID()));
  else if(action==='list')result=listBackups(paths.backupsDir);
  else if(action==='verify')result=verifyBackup(directory);
  else if(action==='restore')result=args.includes('--apply')?await restoreBackup(paths.dbPath,directory,{confirmation:confirmation()}):previewRestore(paths.dbPath,directory);
  else throw new Error('Use backup create/list/verify/restore');
 }else if(command==='upgrade'){if(positional.length>(action==='rollback'?1:0))throw new Error('Unexpected upgrade argument');
  if(action==='plan')result=upgradePlan(paths.dbPath);
  else if(action==='verify')result=verifyUpgrade(paths.dbPath);
  else if(action==='apply')result=await applyUpgrade(paths.dbPath,{confirmation:confirmation()});
  else if(action==='rollback'){const directory=positional[0];result=args.includes('--apply')?await restoreBackup(paths.dbPath,directory,{confirmation:confirmation()}):previewRestore(paths.dbPath,directory);}
  else throw new Error('Use upgrade plan/apply/verify/rollback');
 }else if(command==='reset'){if(positional.length)throw new Error('Unexpected reset argument');
  const options={dataRoot:paths.dataRoot,dbPath:paths.dbPath,scope:action,confirmation:confirmation()};result=args.includes('--apply')?await applyReset(options):previewReset(options);
 }else throw new Error('Use backup, upgrade or reset');
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){reportCliFailure(error,{component:'storage'});process.exitCode=1;}
