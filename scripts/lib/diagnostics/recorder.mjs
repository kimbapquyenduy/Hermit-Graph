import {pruneDiagnostics} from './retention.mjs';
import { randomUUID } from 'node:crypto';
import { safeMetadata } from './redactor.mjs';
import { currentContext } from './context.mjs';
import { writeCapsule } from './crash-capsule.mjs';
export class Recorder {
 constructor({store,mode=process.env.HERMIT_DIAGNOSTICS??'errors',capsuleDirectory,warn=message=>process.stderr.write(message+'\n')}={}){this.store=store;this.mode=mode;this.capsuleDirectory=capsuleDirectory;this.warn=warn;this.writes=0;this.backlog=[];this.dropped=0;this.recording=false;this.warned=false;}
 capture(metadata={},context=currentContext()){const correlationId=context.operationId??randomUUID();if(this.mode==='off')return {correlationId,diagnosticsDegraded:false,disabled:true};const record={metadata:safeMetadata(metadata),context:{...context,operationId:correlationId}};if(this.recording)return {correlationId,diagnosticsDegraded:true};this.recording=true;try{this.flush();const result=this.store.record(record.metadata,record.context);this.maybePrune();return {diagnosticsDegraded:false,...result,correlationId};}catch{if(this.capsuleDirectory){const capsule=writeCapsule({directory:this.capsuleDirectory,metadata:record.metadata,context:record.context});if(capsule.durable)return {correlationId:capsule.correlationId,diagnosticsDegraded:true,durable:true};}if(this.backlog.length<100)this.backlog.push(record);else this.dropped++;if(!this.warned){this.warned=true;try{this.warn('Hermit diagnostics unavailable; bounded evidence is in memory only.');}catch{}}return {correlationId,diagnosticsDegraded:true};}finally{this.recording=false;}}
 flush(){while(this.backlog.length){const item=this.backlog[0];this.store.record(item.metadata,item.context);this.backlog.shift();}if(this.dropped){this.store.addDropped(this.dropped);this.dropped=0;}this.warned=false;}
 success(metadata,context={}){if(this.mode==='off')return;try{this.store.success(metadata,context);this.maybePrune();}catch{this.dropped++;}}
 late(id,state){try{this.store.late(id,state);}catch{this.dropped++;}}
 maybePrune(){if(++this.writes%100===0&&this.store?.db)try{pruneDiagnostics(this.store);}catch{this.dropped++;}}
 health(){return {diagnosticsDegraded:this.backlog.length>0||this.dropped>0,backlog:this.backlog.length,dropped:this.dropped};}
}
