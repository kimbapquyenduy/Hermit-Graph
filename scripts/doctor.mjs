import {openRuntime,graphSnapshot} from './lib/v8-cli-runtime.mjs';
import {ModelManager} from './lib/v8-model.mjs';
import {DiagnosticsStore} from './lib/diagnostics/store.mjs';
import {runtimeHealth} from './lib/diagnostics/health.mjs';
const requestedMode=process.env.HERMIT_SEARCH_MODE||'bm25';
let runtime,diagnostics;
try {
  if(!['bm25','lexical','hybrid','vector'].includes(requestedMode))throw new Error('HERMIT_SEARCH_MODE must be bm25, lexical, hybrid, or vector');
  runtime=openRuntime();
  const integrity=runtime.store.db.prepare('PRAGMA integrity_check').all().map(r=>Object.values(r)[0]);
  const foreignKeys=runtime.store.db.prepare('PRAGMA foreign_key_check').all();
  const schemaVersion=runtime.store.db.prepare('PRAGMA user_version').get().user_version;
  const graph=graphSnapshot(runtime);
  const model=new ModelManager({store:runtime.store,dataDir:runtime.paths.dataRoot}).status();
  const semanticRequested=['hybrid','vector'].includes(requestedMode);
  const semanticEnabled=semanticRequested&&model.installed;
  const healthy=integrity.every(x=>x==='ok')&&!foreignKeys.length;
  diagnostics=new DiagnosticsStore({brainStore:runtime.store});
  const operational=runtimeHealth(diagnostics,null,{projectId:runtime.project?.id??null});
  console.log(JSON.stringify({
    knowledgeHealth:{integrity:healthy?'healthy':'unhealthy',entities:graph.entities.length,relations:graph.relations.length},runtimeHealth:operational,
    status:!healthy?'unhealthy':semanticRequested&&!model.installed?'degraded':'healthy',
    dbPath:runtime.paths.dbPath,schemaVersion,integrity,foreignKeyViolations:foreignKeys.length,
    projectId:runtime.project?.id??null,includeGlobal:runtime.scope.includeGlobal,
    entities:graph.entities.length,relations:graph.relations.length,
    requestedMode,effectiveMode:semanticEnabled?requestedMode:'bm25',semanticEnabled,
    semanticReason:semanticRequested?model.reason:'not requested',model,
    runtimeValidated:false,diagnosticScope:'Read-only artifact and database validation; inference is not loaded or executed'
  },null,2));
  if(!healthy)process.exitCode=1;
} catch(error) {
  console.log(JSON.stringify({status:'unhealthy',requestedMode,effectiveMode:'unavailable',error:error.message},null,2));
  process.exitCode=1;
} finally {diagnostics?.close();runtime?.store.close();}
