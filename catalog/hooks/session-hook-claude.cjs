#!/usr/bin/env node
'use strict';
const {startSession,endSession}=require('./lib/session-core.cjs');
try{
 const input=require('node:fs').readFileSync(0,'utf8');if(Buffer.byteLength(input)>1048576)throw new Error('input too large');const p=JSON.parse(input||'{}');
 const event=p.hook_event_name||p.event;
 if(typeof p.cwd!=='string'||!p.cwd)throw new Error('cwd required');
 const agent='claude';
 const result=event==='SessionEnd'||event==='end'?endSession(p.cwd,agent,p.session_id):event==='SessionStart'||event==='start'?startSession(p.cwd,agent,p.session_id):{degraded:true,code:'HERMIT_HOOK_EVENT_UNSUPPORTED'};
 if(result?.degraded)process.stderr.write(result.code+'\n');
}catch(error){require('./lib/sqlite-bridge.cjs').reportHookFailure(error);process.exitCode=1;}
