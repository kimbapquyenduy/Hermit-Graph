import {currentContext,safeContext,enterProcessContext} from './context.mjs';
import {uuidV7} from './uuid-v7.mjs';
import {resolvePaths} from '../storage/paths.mjs';
import {writeCapsule} from './crash-capsule.mjs';
import {safeErrorEnvelope} from './redactor.mjs';
// CLI failure paths must work even when the DB is locked or cannot open.
export function reportCliFailure(error,{component='cli',phase='request',persist=true}={}){
 enterProcessContext();
 currentContext().failureReported=true;
 if(safeContext({operationId:error?.correlationId}).operationId){const result=safeErrorEnvelope({code:error?.code,correlationId:error.correlationId,diagnosticsDegraded:error.diagnosticsDegraded===true});process.stderr.write(JSON.stringify(result)+'\n');return result;}
 const context=safeContext({...currentContext(),traceId:currentContext().traceId??uuidV7(),operationId:currentContext().operationId??uuidV7()});
 let capsule={durable:false};
 if(persist&&process.env.HERMIT_DIAGNOSTICS!=='off')try{capsule=writeCapsule({directory:resolvePaths().crashSpoolDir,metadata:{code:error?.code,component,phase,operation:currentContext().operation},context});}catch{}
 const result=safeErrorEnvelope({code:error?.code,correlationId:capsule.correlationId||context.operationId,diagnosticsDegraded:process.env.HERMIT_DIAGNOSTICS!=='off'&&!capsule.durable});
 process.stderr.write(JSON.stringify(result)+'\n');return result;
}
