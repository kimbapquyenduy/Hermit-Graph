function limit(value,fallback){return Number.isInteger(value)&&value>=0?value:fallback;}
export function pruneDiagnostics(store,{dryRun=false,now=Date.now(),occurrenceLimit=2000,operationLimit=20000,sessionLimit=5000,fingerprintLimit=5000,bucketLimit=100000,transitionLimit=20000}={}){
 const db=store.db,cutoff=now-30*86400000;
 const count=table=>db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
 const before=Object.fromEntries(['diag_occurrence','diag_operation','diag_session','diag_fingerprint','diag_bucket','diag_transition','diag_import'].map(t=>[t,count(t)]));
 if(dryRun)return {apply:false,before,policy:{cutoff,occurrenceLimit,operationLimit,sessionLimit,fingerprintLimit,bucketLimit,transitionLimit}};
 return store.transaction(()=>{
  for(const [table,column,cap] of [['diag_occurrence','created_at',limit(occurrenceLimit,2000)],['diag_operation','created_at',limit(operationLimit,20000)]]){db.prepare(`DELETE FROM ${table} WHERE ${column}<?`).run(cutoff);db.prepare(`DELETE FROM ${table} WHERE rowid IN(SELECT rowid FROM ${table} ORDER BY ${column} DESC,rowid DESC LIMIT -1 OFFSET ?)`).run(cap);}
  db.prepare("UPDATE diag_session SET state='ABANDONED' WHERE state='ACTIVE' AND heartbeat_at<?").run(now-30*60*1000);
  db.prepare("DELETE FROM diag_session WHERE state IN('CLOSED','ABANDONED') AND heartbeat_at<?").run(cutoff);
  db.prepare("DELETE FROM diag_session WHERE id IN(SELECT id FROM diag_session WHERE state IN('CLOSED','ABANDONED') ORDER BY heartbeat_at DESC LIMIT -1 OFFSET ?)").run(limit(sessionLimit,5000));
  // Compact bucket totals before removal so lifetime health totals survive age and row limits.
  const expired=db.prepare('SELECT day,scope,component,successes,failures FROM diag_bucket WHERE day<? OR rowid IN(SELECT rowid FROM diag_bucket ORDER BY day DESC LIMIT -1 OFFSET ?)').all(Math.floor(now/86400000)-365,limit(bucketLimit,100000));
  for(const row of expired){for(const [key,value] of [['pruned_successes',row.successes],['pruned_failures',row.failures]])db.prepare('INSERT INTO diag_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=value+excluded.value').run(key,value);db.prepare('DELETE FROM diag_bucket WHERE day=? AND scope=? AND component=?').run(row.day,row.scope,row.component);}
  // Never evict unresolved or incident-linked aggregate identities.
  db.prepare("DELETE FROM diag_fingerprint WHERE id IN(SELECT id FROM diag_fingerprint WHERE state IN('IGNORED','CLOSED','VERIFIED_FIXED') AND incident_entity_id IS NULL ORDER BY last_seen LIMIT ?)").run(Math.max(0,count('diag_fingerprint')-limit(fingerprintLimit,5000)));
  // Protected histories remain intact; callers see over-budget state rather than destructive eviction.
  db.prepare("DELETE FROM diag_transition WHERE fingerprint_id IN(SELECT id FROM diag_fingerprint WHERE state IN('CLOSED','IGNORED') AND incident_entity_id IS NULL) AND (created_at<? OR rowid IN(SELECT rowid FROM diag_transition ORDER BY created_at DESC LIMIT -1 OFFSET ?))").run(cutoff,limit(transitionLimit,20000));
  // Import tombstones deliberately remain: deleting them would allow duplicate replay.
  db.prepare("INSERT INTO diag_meta VALUES('prune_watermark',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(now);
  const after=Object.fromEntries(Object.keys(before).map(t=>[t,count(t)]));return {apply:true,before,after,protectedOverBudget:after.diag_fingerprint>limit(fingerprintLimit,5000)||after.diag_transition>limit(transitionLimit,20000)};
 });
}
