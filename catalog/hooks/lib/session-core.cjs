'use strict';
const fs = require('fs');
const path = require('path');

function resolveSessionPath(cwd) {
  const dir = path.join(cwd || process.cwd(), '.hermit');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'session.json');
}

function startSession(cwd, agent) {
  const sessionPath = resolveSessionPath(cwd);
  const now = new Date();
  const session = {
    sessionId: now.toISOString().replace(/[-:T]/g, '').slice(0, 13),
    startedAt: now.toISOString(),
    cwd: cwd || process.cwd(),
    agent: agent || 'unknown',
  };
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
  return session;
}

function endSession(cwd) {
  const sessionPath = resolveSessionPath(cwd);
  if (!fs.existsSync(sessionPath)) return null;
  try {
    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    session.endedAt = new Date().toISOString();
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
    return session;
  } catch { return null; }
}

function getSessionInfo(cwd) {
  const sessionPath = resolveSessionPath(cwd);
  if (!fs.existsSync(sessionPath)) return null;
  try { return JSON.parse(fs.readFileSync(sessionPath, 'utf-8')); }
  catch { return null; }
}

module.exports = { startSession, endSession, getSessionInfo };
