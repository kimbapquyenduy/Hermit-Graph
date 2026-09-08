#!/usr/bin/env node
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const files=['scripts/hermit-hook.mjs','scripts/lib/project-learner.mjs','scripts/lib/deep-scan-collector.mjs','scripts/lib/deep-scan-module.mjs','scripts/lib/hook-export.mjs','scripts/setup-project.mjs','scripts/lib/setup-module.mjs'];
function visit(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())visit(p);else if(e.name.endsWith('.cjs'))files.push(p);}}visit('catalog/hooks');
const forbidden=/\b(?:readBrain|writeBrain|withBrainLock|MEMORY_FILE_PATH|BRAIN_FILE)\b|brain-io\.mjs|['"`]([^'"`]*[\\/])?brain\.jsonl['"`]/;
const failures=files.filter(p=>forbidden.test(readFileSync(p,'utf8')));
if(failures.length){console.error('Knowledge JSONL authority remains: '+failures.join(', '));process.exitCode=1;}else console.log(`Hook/scanner SQLite authority check passed (${files.length} files). Session metadata and derived code indexes are outside knowledge authority.`);
