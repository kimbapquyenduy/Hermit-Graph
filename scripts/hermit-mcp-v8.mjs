import {registerV8Capabilities} from './lib/v8-capabilities.mjs';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {BrainStore} from './lib/storage/brain-store.mjs';
import {resolvePaths} from './lib/storage/paths.mjs';
import {MemoryService} from './lib/memory-service.mjs';
import {registerV8Memory} from './lib/v8-memory-module.mjs';
import {DiagnosticsStore} from './lib/diagnostics/store.mjs';
import {pruneDiagnostics} from './lib/diagnostics/retention.mjs';
import {Recorder} from './lib/diagnostics/recorder.mjs';
import {instrumentServer} from './lib/diagnostics/instrument-server.mjs';
import {importCapsules} from './lib/diagnostics/crash-capsule.mjs';
import {registerDiagnostics} from './lib/diagnostics-module.mjs';
import {SessionService} from './lib/runtime/session-service.mjs';
const paths=resolvePaths();const store=new BrainStore({dbPath:paths.dbPath});
const service=new MemoryService({store});const cwd=process.env.HERMIT_PROJECT_CWD||process.env.CLAUDE_PROJECT_DIR||process.env.HERMIT_USER_CWD;
if(cwd)service.startSession(cwd);
let diagnosticStore;try{diagnosticStore=new DiagnosticsStore({brainStore:store});importCapsules({directory:paths.crashSpoolDir,store:diagnosticStore});pruneDiagnostics(diagnosticStore);}catch{}
const recorder=new Recorder({store:diagnosticStore,capsuleDirectory:paths.crashSpoolDir,warn:message=>process.stderr.write(message+'\n')});
const sessions=new SessionService({store});sessions.startProcess({projectId:service.projectId??null});
const server=new McpServer({name:'hermit-graph',version:'8.0.0-dev'});
instrumentServer(server,{recorder,projectId:()=>service.projectId??null,timeoutMs:30000});
registerV8Memory(server,service);registerV8Capabilities(server,service,paths);
if(diagnosticStore)registerDiagnostics(server,{store:diagnosticStore,recorder,projectId:()=>service.projectId??null});
const transport=new StdioServerTransport();await server.connect(transport);
let closed=false;export function shutdown(){if(closed)return;closed=true;try{sessions.closeProcess();}finally{try{diagnosticStore?.close();}finally{store.close();}}}
transport.onclose=shutdown;
process.once('SIGINT',()=>{shutdown();process.exit(0);});process.once('SIGTERM',()=>{shutdown();process.exit(0);});
