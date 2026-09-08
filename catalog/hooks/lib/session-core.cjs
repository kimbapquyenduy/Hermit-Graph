'use strict';
/**
 * Session tracking — append-only, one record per session.
 *
 * The previous design wrote a single `.hermit/session.json` that every agent
 * overwrote, so two concurrent agents clobbered each other and a finished
 * session could masquerade as the live one. Its sessionId was also only
 * minute-precise, so same-minute starts collided.
 *
 * Now: one file per session under `.hermit/sessions/`, plus an append-only
 * `index.jsonl` event log. "Current session" is resolved by process liveness,
 * not by whichever file was written last.
 */
const fs = require('fs');
const path = require('path');

/** Records older than this are pruned on start. */
const RETENTION_DAYS = 14;

function sessionsDir(cwd) {
  const dir = path.join(cwd || process.cwd(), '.hermit', 'sessions');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function indexPath(cwd) {
  return path.join(sessionsDir(cwd), 'index.jsonl');
}

/** Filesystem-safe, collision-resistant session id. */
function makeSessionId(agent, now) {
  const stamp = now.toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${agent}-${process.pid}`;
}

function recordPath(cwd, sessionId) {
  return path.join(sessionsDir(cwd), `${sessionId}.json`);
}

/** Append one event to the index. Append-only, so concurrent writers don't clobber. */
function appendIndex(cwd, event) {
  try {
    fs.appendFileSync(indexPath(cwd), JSON.stringify(event) + '\n', 'utf-8');
  } catch { /* index is advisory — never fail a hook on it */ }
}

/** Is the process that owns this session still running? */
function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (err) { return err && err.code === 'EPERM'; }
}

/**
 * Read every session record in the directory, newest first.
 * @param {string} cwd
 * @returns {object[]}
 */
function listSessions(cwd) {
  const dir = sessionsDir(cwd);
  let files;
  try { files = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      if (rec && rec.sessionId) out.push(rec);
    } catch { /* skip unreadable record */ }
  }
  out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return out;
}

/**
 * Delete records older than RETENTION_DAYS. Keeps the directory bounded
 * without needing a separate cleanup job.
 * @param {string} cwd
 * @param {number} [days]
 * @returns {number} records removed
 */
function pruneSessions(cwd, days = RETENTION_DAYS) {
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  for (const rec of listSessions(cwd)) {
    const started = Date.parse(rec.startedAt || '');
    if (!started || started >= cutoff) continue;
    try { fs.unlinkSync(recordPath(cwd, rec.sessionId)); removed++; }
    catch { /* already gone */ }
  }
  return removed;
}

/**
 * Open a session for this process.
 * @param {string} cwd
 * @param {string} agent
 * @returns {object} the session record
 */
function startSession(cwd, agent) {
  const now = new Date();
  const agentName = agent || 'unknown';
  const session = {
    sessionId: makeSessionId(agentName, now),
    startedAt: now.toISOString(),
    cwd: cwd || process.cwd(),
    agent: agentName,
    pid: process.pid,
  };
  fs.writeFileSync(recordPath(cwd, session.sessionId), JSON.stringify(session, null, 2), 'utf-8');
  appendIndex(cwd, { event: 'start', ...session });
  pruneSessions(cwd);
  return session;
}

/**
 * Close the session owned by THIS process (not "whatever was written last").
 * @param {string} cwd
 * @returns {object|null} the closed record, or null if none matched
 */
function endSession(cwd) {
  const mine = listSessions(cwd).find(r => r.pid === process.pid && !r.endedAt);
  if (!mine) return null;
  mine.endedAt = new Date().toISOString();
  try {
    fs.writeFileSync(recordPath(cwd, mine.sessionId), JSON.stringify(mine, null, 2), 'utf-8');
  } catch { return null; }
  appendIndex(cwd, { event: 'end', sessionId: mine.sessionId, endedAt: mine.endedAt, agent: mine.agent });
  return mine;
}

/**
 * Resolve the current session: the newest still-running one, else the newest
 * that never recorded an end, else the newest record.
 * @param {string} cwd
 * @returns {object|null}
 */
function getSessionInfo(cwd) {
  const all = listSessions(cwd);
  if (!all.length) return null;
  return all.find(r => !r.endedAt && isAlive(r.pid))
    || all.find(r => !r.endedAt)
    || all[0];
}

module.exports = {
  startSession, endSession, getSessionInfo,
  listSessions, pruneSessions, isAlive,
};
