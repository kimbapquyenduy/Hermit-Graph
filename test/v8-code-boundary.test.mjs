import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('v8 boot and code query never resolve legacy embeddings or Transformers', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { registerHooks } from 'node:module';
    import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import assert from 'node:assert/strict';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.includes('embedding-service') || specifier.includes('@huggingface/transformers')) throw new Error('forbidden legacy model import: '+specifier);
      return next(specifier, context);
    }});
    const { registerV8Capabilities } = await import('./scripts/lib/v8-capabilities.mjs');
    const root = mkdtempSync(join(tmpdir(), 'v8-code-boundary-'));
    try {
      mkdirSync(join(root,'data'));
      writeFileSync(join(root,'data','code-symbols.jsonl'), JSON.stringify({_type:'symbol',id:'auth.js::authenticate',name:'authenticate',kind:'function',file:'auth.js',line:[1,2],exported:true})+'\\n');
      const tools = new Map();
      const server = {tool(name,description,schema,...rest){tools.set(name,{schema,handler:rest.at(-1)});}};
      const store = {getProject:()=>({rootPath:root}),search:()=>[]};
      registerV8Capabilities(server,{store,projectId:'p'},{dataRoot:root});
      const result = await tools.get('hermit_query').handler({query:'authenticate'});
      assert.equal(result.isError,undefined,JSON.stringify(result));
      assert.match(result.content[0].text,/authenticate/);
      assert.equal(existsSync(join(root,'data','code-embeddings.json')),false);
      for (const mode of ['semantic','vector']) {
        assert.equal(tools.get('hermit_semantic_search').schema.mode.safeParse(mode).success,true);
        const response = await tools.get('hermit_semantic_search').handler({query:'auth',mode});
        assert.equal(JSON.parse(response.content[0].text).degraded,true);
      }
    } finally { rmSync(root,{recursive:true,force:true}); }
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
