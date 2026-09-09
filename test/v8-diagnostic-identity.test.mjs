import test from 'node:test';import assert from 'node:assert/strict';
import {faultMaterial} from '../scripts/lib/diagnostics/fault-material.mjs';
import {fingerprint} from '../scripts/lib/diagnostics/fingerprint.mjs';
import {withContext,currentContext} from '../scripts/lib/diagnostics/context.mjs';
const salt=Buffer.alloc(32,7),options={salt,rootPath:'/package',operation:'hermit_index'};
function error(message,frame='build'){const e=new TypeError(message);e.stack=`TypeError: ${message}\n at ${frame} (/package/scripts/lib/indexer.mjs:12:34)\n at run (/package/scripts/app.mjs:98:2)`;return e;}
test('fault identity normalizes variable values, distinguishes causes and never retains message text',()=>{
 const a=faultMaterial(error('Failed entity "one" at port 1234'),options),b=faultMaterial(error('Failed entity "two" at port 9876'),options);
 assert.equal(fingerprint(a),fingerprint(b));assert.notEqual(fingerprint(a),fingerprint(faultMaterial(error('Parser rejected source'),options)));assert.notEqual(fingerprint(a),fingerprint(faultMaterial(error('Failed entity "one" at port 1234','parse'),options)));
 const privateFault=faultMaterial(error('password=SENTINEL_PRIVATE_PASSWORD'),options);assert.ok(!JSON.stringify(privateFault).includes('SENTINEL_PRIVATE_PASSWORD'));assert.ok(!JSON.stringify(privateFault).includes('/package'));assert.equal(privateFault.operation,'hermit_index');assert.equal(privateFault.errorName,'TypeError');
 assert.notEqual(faultMaterial(error('Parser rejected source'),{...options,salt:Buffer.alloc(32,8)}).signature,faultMaterial(error('Parser rejected source'),options).signature);
});
test('UUIDv7 contexts isolate concurrent requests and preserve session/parent linkage',async()=>{
 const ids=new Set();await Promise.all(Array.from({length:30},(_,i)=>withContext(async()=>{const parent={...currentContext()};await new Promise(r=>setTimeout(r,i%3));assert.equal(currentContext().operationId,parent.operationId);assert.match(parent.operationId,/^[a-f0-9-]{14}7/);assert.equal(parent.sessionId,'11111111-1111-7111-8111-111111111111');ids.add(parent.operationId);await withContext(async()=>{assert.equal(currentContext().traceId,parent.traceId);assert.equal(currentContext().parentOperationId,parent.operationId);assert.notEqual(currentContext().operationId,parent.operationId);});},{sessionId:'11111111-1111-7111-8111-111111111111'})));
 assert.equal(ids.size,30);assert.deepEqual(currentContext(),{});
});
