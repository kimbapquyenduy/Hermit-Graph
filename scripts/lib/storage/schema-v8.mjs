import {SESSION_SCHEMA_SQL} from '../runtime/session-service.mjs';
import {DIAGNOSTICS_SCHEMA_SQL} from '../diagnostics/store.mjs';
export const CURRENT_SCHEMA_REVISION=2;
export function initializeExtendedSchema(db){
 db.exec("CREATE TABLE IF NOT EXISTS schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;");
 db.exec(DIAGNOSTICS_SCHEMA_SQL);
 db.exec(SESSION_SCHEMA_SQL);
 db.exec("CREATE TABLE IF NOT EXISTS semantic_vectors(entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,content_hash TEXT NOT NULL,model TEXT NOT NULL,dimension INTEGER NOT NULL,vector BLOB NOT NULL)");
 db.exec(`CREATE TABLE IF NOT EXISTS scan_runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),root_path TEXT NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,committed_at TEXT) STRICT;`);
 db.prepare("INSERT INTO schema_meta(key,value) VALUES('revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(CURRENT_SCHEMA_REVISION));
}
