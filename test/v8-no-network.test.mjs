import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
test('default core MCP tools make zero socket, DNS or fetch calls',t=>{
 const root=mkdtempSync(join(tmpdir(),'hermit-no-network-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const guard=join(root,'guard.mjs'),marker=join(root,'network-attempt');
 writeFileSync(guard,`import net from 'node:net';import tls from 'node:tls';import dns from 'node:dns';import {writeFileSync} from 'node:fs';const deny=()=>{writeFileSync(${JSON.stringify(marker)},'attempt');throw Error('Network forbidden in default runtime');};net.Socket.prototype.connect=deny;net.connect=deny;net.createConnection=deny;tls.connect=deny;dns.lookup=deny;dns.resolve=deny;dns.promises.lookup=deny;dns.promises.resolve=deny;globalThis.fetch=deny;`);
 const result=spawnSync(process.execPath,[resolve('scripts/package-smoke.mjs')],{env:{...process.env,NODE_OPTIONS:`--import=${pathToFileURL(guard).href}`},encoding:'utf8',timeout:120000});assert.equal(result.status,0,result.stderr);assert.equal(existsSync(marker),false);
});
