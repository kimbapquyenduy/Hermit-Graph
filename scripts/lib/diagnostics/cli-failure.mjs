import {randomUUID} from 'node:crypto';
import {resolvePaths} from '../storage/paths.mjs';
import {writeCapsule} from './crash-capsule.mjs';
import {safeErrorEnvelope} from './redactor.mjs';
// CLI failure paths must work even when the DB is locked or cannot open.
export function reportCliFailure(error,{component='cli',phase='request'}={}){
 let capsule={durable:false};
 if(process.env.HERMIT_DIAGNOSTICS!=='off')try{capsule=writeCapsule({directory:resolvePaths().crashSpoolDir,metadata:{code:error?.code,component,phase}});}catch{}
 const result=safeErrorEnvelope({code:error?.code,correlationId:capsule.id||randomUUID(),diagnosticsDegraded:process.env.HERMIT_DIAGNOSTICS!=='off'&&!capsule.durable});
 process.stderr.write(JSON.stringify(result)+'\n');return result;
}
