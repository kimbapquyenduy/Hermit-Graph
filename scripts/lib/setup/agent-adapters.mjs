import {join} from 'node:path';
import {existsSync} from 'node:fs';
const capabilities=Object.freeze({mcp:'stdio',hooks:[],stableSessionId:'none',sessionLifecycle:'degraded',commands:false,skills:false,uninstall:true,verification:'config-and-mcp-smoke'});
export const AGENT_ADAPTERS=Object.freeze([
 {id:'claude',format:'jsonc',config:c=>join(c.projectRoot,'.mcp.json'),detect:c=>existsSync(join(c.home,'.claude'))},
 {id:'cursor',format:'jsonc',config:c=>join(c.home,'.cursor','mcp.json'),detect:c=>existsSync(join(c.home,'.cursor'))},
 {id:'gemini-cli',format:'jsonc',config:c=>join(c.home,'.gemini','settings.json'),detect:c=>existsSync(join(c.home,'.gemini'))},
 {id:'windsurf',format:'jsonc',config:c=>join(c.home,'.codeium','windsurf','mcp_config.json'),detect:c=>existsSync(join(c.home,'.codeium','windsurf'))},
 {id:'cline',format:'jsonc',config:c=>join(c.appData||join(c.home,'AppData','Roaming'),'Code','User','globalStorage','saoudrizwan.claude-dev','settings','cline_mcp_settings.json'),detect:c=>existsSync(join(c.appData||join(c.home,'AppData','Roaming'),'Code','User','globalStorage','saoudrizwan.claude-dev'))},
 {id:'codex',format:'toml',config:c=>join(c.home,'.codex','config.toml'),detect:c=>existsSync(join(c.home,'.codex'))},
 {id:'opencode',format:'jsonc',config:c=>join(c.home,'.config','opencode','opencode.json'),detect:c=>existsSync(join(c.home,'.config','opencode'))},
].map(a=>Object.freeze({...a,...(['claude','codex'].includes(a.id)?{hookFile:c=>join(a.id==='claude'?c.projectRoot:c.home,'.'+a.id,'hooks','hermit','session.cjs'),hookConfig:c=>a.id==='claude'?join(c.projectRoot,'.claude','settings.json'):a.config(c)}:{}),capabilities:['claude','codex'].includes(a.id)?{...capabilities,hooks:['SessionStart','SessionEnd'],stableSessionId:'stable',sessionLifecycle:'stable'}:capabilities})));
export function selectAdapters(agent='auto',context){const aliases={'claude-code':'claude',gemini:'gemini-cli'};agent=aliases[agent]||agent;if(agent==='auto')return AGENT_ADAPTERS.filter(a=>a.detect(context)||context.activeAgent===a.id);if(agent==='all')return [...AGENT_ADAPTERS];const a=AGENT_ADAPTERS.find(a=>a.id===agent);if(!a)throw new Error('HERMIT_UNKNOWN_AGENT: '+agent);return [a];}
