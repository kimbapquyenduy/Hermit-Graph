import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import {uuidV7 as randomUUID} from './uuid-v7.mjs';
const storage=new AsyncLocalStorage();
export function currentContext(){return storage.getStore()??{};}
export function enterProcessContext(env=process.env){if(currentContext().operationId)return currentContext();let inherited={};try{inherited=safeContext(JSON.parse(env.HERMIT_DIAGNOSTIC_CONTEXT||'{}'));}catch{}const context={...inherited,traceId:inherited.traceId??randomUUID(),parentOperationId:inherited.operationId??null,operationId:randomUUID()};storage.enterWith(context);return context;}
export function childEnvironment(env=process.env){return {...env,HERMIT_DIAGNOSTIC_CONTEXT:JSON.stringify(safeContext(currentContext()))};}
export function withContext(callback,{upstreamSessionId,sessionId}={}){const parent=currentContext();return storage.run({traceId:parent.traceId??randomUUID(),operationId:randomUUID(),parentOperationId:parent.operationId??null,sessionId:sessionId??(upstreamSessionId?createHash('sha256').update(String(upstreamSessionId)).digest('hex'):parent.sessionId??null)},callback);}

export function safeContext(input={}){const valid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);return Object.fromEntries(['projectId','sessionId','traceId','operationId','parentOperationId'].map(key=>[key,valid(input[key])?input[key]:null]));}
