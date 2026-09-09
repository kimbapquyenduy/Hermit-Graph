#!/usr/bin/env node
import {randomUUID} from 'node:crypto';
import {resolvePaths} from './lib/storage/paths.mjs';
import {writeCapsule} from './lib/diagnostics/crash-capsule.mjs';
import {safeErrorEnvelope} from './lib/diagnostics/redactor.mjs';
let failed=false,app;
function fatal(error){if(failed)return;failed=true;let capture={durable:false};try{if(process.env.HERMIT_DIAGNOSTICS!=='off')capture=writeCapsule({directory:resolvePaths().crashSpoolDir,metadata:{code:error?.code,component:'runtime',phase:app?'background':'startup'}});}catch{}const envelope=safeErrorEnvelope({code:error?.code,correlationId:capture.id||randomUUID(),diagnosticsDegraded:process.env.HERMIT_DIAGNOSTICS!=='off'&&!capture.durable});process.stderr.write(JSON.stringify(envelope)+'\n');try{app?.shutdown();}catch{}process.exitCode=1;setTimeout(()=>process.exit(1),10).unref();}
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
try{if(Number(process.versions.node.split('.')[0])<24)throw Object.assign(new Error('Node 24 required'),{code:'HERMIT_NODE_UNSUPPORTED'});if(process.env.HERMIT_STORAGE&&process.env.HERMIT_STORAGE!=='v8')throw Object.assign(new Error('Use the matching legacy release'),{code:'HERMIT_LEGACY_RUNTIME_REQUIRED'});app=await import('./hermit-mcp-v8.mjs');}catch(error){fatal(error);}
