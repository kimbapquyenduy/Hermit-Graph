import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

for (const scenario of ['partial-cache', 'invalid-cache', 'explicit-install']) {
  test(`model network boundary: ${scenario}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'hermit-offline-model-'));
    try {
      const lib = join(root, 'scripts', 'lib');
      mkdirSync(lib, { recursive: true });
      // Preserve production implementation and use a temporary package/data root.
      // Resolve the real Transformers module; no loader/model implementation mock.
      const source = readFileSync(new URL('../scripts/lib/embedding-service.mjs', import.meta.url), 'utf8')
        .replace("'@huggingface/transformers'", JSON.stringify(import.meta.resolve('@huggingface/transformers')));
      const servicePath = join(lib, 'embedding-service.mjs');
      writeFileSync(servicePath, source);
      const modelRoot = join(root, 'data', '.model-cache', 'Xenova', 'all-MiniLM-L6-v2');
      mkdirSync(join(modelRoot, 'onnx'), { recursive: true });
      if (scenario === 'invalid-cache') {
        writeFileSync(join(modelRoot, 'config.json'), '{}');
        writeFileSync(join(modelRoot, 'tokenizer.json'), '{}');
        writeFileSync(join(modelRoot, 'onnx', 'model.onnx'), 'invalid model fixture');
      }
      const child = `
        let requests = 0;
        globalThis.fetch = async () => { requests++; throw new Error('test intercept: network forbidden'); };
        const service = await import(${JSON.stringify(pathToFileURL(servicePath).href)});
        const available = await service.isAvailable();
        console.log(JSON.stringify({ requests, available }));
      `;
      const env = { ...process.env, HERMIT_EMBED_LOAD_TIMEOUT_MS: '3000' };
      delete env.HERMIT_ALLOW_MODEL_DOWNLOAD;
      if (scenario === 'explicit-install') env.HERMIT_ALLOW_MODEL_DOWNLOAD = '1';
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', child], { env, encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, result.stderr || String(result.error));
      const output = JSON.parse(result.stdout.trim().split('\n').at(-1));
      assert.equal(output.available, false);
      if (scenario === 'explicit-install') assert.ok(output.requests > 0, 'installer must retain explicit remote resolution');
      else assert.equal(output.requests, 0, 'runtime must never request remote model files');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
