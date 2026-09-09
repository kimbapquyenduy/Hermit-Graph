#!/usr/bin/env node
import {reportCliFailure} from './lib/diagnostics/cli-failure.mjs';
import { ModelManager } from './lib/v8-model.mjs';
import { resolvePaths } from './lib/storage/paths.mjs';

const [command = 'status', ...args] = process.argv.slice(2);
let store;
try {
  if (!['status', 'install', 'backfill'].includes(command)) throw new Error('Usage: hermit semantic status|install|backfill [--cwd PATH] [--include-global] [--all]');
  let cwd = process.env.HERMIT_USER_CWD || process.cwd(), includeGlobal = false, all = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd' && args[i + 1]) cwd = args[++i];
    else if (args[i] === '--include-global') includeGlobal = true;
    else if (args[i] === '--all') all = true;
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  const paths = resolvePaths({ env: process.env });
  if (command === 'backfill') {
    const { BrainStore } = await import('./lib/storage/brain-store.mjs');
    const { resolveProject } = await import('./lib/storage/project-resolver.mjs');
    store = new BrainStore({ dbPath: paths.dbPath });
    const project = resolveProject(store, { rootPath: cwd, create: false });
    const manager = new ModelManager({ store, dataDir: paths.dataDir });
    console.log(JSON.stringify(all ? await manager.backfillAll() : await manager.backfill({ projectId: project?.id ?? '__unresolved__', includeGlobal }), null, 2));
  } else {
    const manager = new ModelManager({ dataDir: paths.dataDir });
    console.log(JSON.stringify(command === 'install' ? await manager.install() : manager.status(), null, 2));
  }
} catch (error) { reportCliFailure(error,{component:'model'}); process.exitCode = 1; }
finally { store?.close(); }
