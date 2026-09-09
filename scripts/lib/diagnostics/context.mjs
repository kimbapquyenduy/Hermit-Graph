import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import {uuidV7 as randomUUID} from './uuid-v7.mjs';
const storage=new AsyncLocalStorage();
export function currentContext(){return storage.getStore()??{};}
export function withContext(callback,{upstreamSessionId}={}){const parent=currentContext();return storage.run({traceId:parent.traceId??randomUUID(),operationId:randomUUID(),parentOperationId:parent.operationId??null,sessionId:upstreamSessionId?createHash('sha256').update(String(upstreamSessionId)).digest('hex'):parent.sessionId??null},callback);}
