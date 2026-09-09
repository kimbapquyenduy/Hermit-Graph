'use strict';
// Session identity comes from the client, never the short-lived hook PID.
const {invoke}=require('./sqlite-bridge.cjs');
function missing(){return {degraded:true,sessionLifecycle:'degraded',code:'HERMIT_STABLE_SESSION_REQUIRED',sessionId:null};}
function startSession(cwd,agent,upstreamSessionId){if(!upstreamSessionId)return missing();return invoke({op:'session-start',cwd,agent,upstreamSessionId});}
function endSession(cwd,agent,upstreamSessionId){if(!upstreamSessionId)return missing();return invoke({op:'session-end',cwd,agent,upstreamSessionId});}
function listSessions(cwd){return invoke({op:'session-list',cwd});}
function getSessionInfo(cwd,agent,upstreamSessionId){if(!upstreamSessionId)return null;return startSession(cwd,agent,upstreamSessionId);}
module.exports={startSession,endSession,listSessions,getSessionInfo};
