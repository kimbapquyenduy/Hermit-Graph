/**
 * Project Learner — deterministic project scanner for hermit setup.
 * Reads config files (package.json, tsconfig, README, etc.) and writes
 * BIZ + TECH candidate entities to SQLite. No AI needed — pure file parsing.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import {BrainStore} from './storage/brain-store.mjs';
import {resolvePaths} from './storage/paths.mjs';
import {MemoryService} from './memory-service.mjs';

// ── Framework detection maps ──

const FRAMEWORKS = {
  'next': 'Next.js', 'react': 'React', 'vue': 'Vue', 'nuxt': 'Nuxt',
  'svelte': 'Svelte', '@sveltejs/kit': 'SvelteKit', 'solid-js': 'SolidJS',
  'angular': 'Angular', '@angular/core': 'Angular',
  'express': 'Express', 'fastify': 'Fastify', '@nestjs/core': 'NestJS',
  'hono': 'Hono', 'koa': 'Koa', '@adonisjs/core': 'AdonisJS',
  '@remix-run/node': 'Remix', 'astro': 'Astro', 'gatsby': 'Gatsby',
};

const TOOLS = {
  'vite': 'Vite', 'webpack': 'Webpack', 'esbuild': 'esbuild', 'turbo': 'Turborepo',
  'vitest': 'Vitest', 'jest': 'Jest', 'mocha': 'Mocha', 'playwright': 'Playwright',
  'cypress': 'Cypress', 'eslint': 'ESLint', 'prettier': 'Prettier',
  '@biomejs/biome': 'Biome', 'tailwindcss': 'Tailwind CSS',
  'prisma': 'Prisma', 'drizzle-orm': 'Drizzle', 'typeorm': 'TypeORM',
  'sequelize': 'Sequelize', 'mongoose': 'Mongoose',
};

const FRONTEND_KEYS = new Set([
  'next', 'react', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', 'solid-js',
  'angular', '@angular/core', '@remix-run/node', 'astro', 'gatsby',
]);

const BACKEND_KEYS = new Set([
  'express', 'fastify', '@nestjs/core', 'hono', 'koa', '@adonisjs/core',
]);

// ── Helpers ──

function safeJsonRead(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function safeTextRead(filePath, maxChars = 2000) {
  try { return readFileSync(filePath, 'utf-8').slice(0, maxChars); } catch { return null; }
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function obs(text) {
  return `[0.6|${todayISO()}] ${text}`;
}

/** Strip [confidence|date] prefix for dedup comparison */
function obsBody(raw) {
  const s = typeof raw === 'string' ? raw : raw.content || '';
  return s.replace(/^\[\d+(?:\.\d+)?\|\d{4}-\d{2}-\d{2}\]\s*/, '');
}

function toPascalCase(str) {
  // Strip npm scope prefix (@org/pkg → pkg) before transforming
  const clean = str.replace(/^@[^/]+\//, '');
  return clean.replace(/[-_.]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\s/g, '');
}

function matchDeps(deps, map) {
  if (!deps) return [];
  return Object.keys(deps)
    .filter(k => map[k])
    .map(k => map[k]);
}

function pushUnique(arr, items) {
  for (const item of items) {
    if (!arr.includes(item)) arr.push(item);
  }
}

// ── Core scanner ──

export function scanProject(projectRoot) {
  const info = { name: null, description: null, language: null, moduleSystem: null,
    frameworks: [], tools: [], frontend: [], backend: [], infra: [], test: [] };

  // 1. package.json
  const pkg = safeJsonRead(join(projectRoot, 'package.json'));
  if (pkg) {
    info.name = pkg.name || null;
    info.description = pkg.description || null;
    info.moduleSystem = pkg.type === 'module' ? 'ESM' : 'CJS';
    info.language = existsSync(join(projectRoot, 'tsconfig.json')) ? 'TypeScript' : 'JavaScript';

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    info.frameworks = matchDeps(allDeps, FRAMEWORKS);
    info.tools = matchDeps(pkg.devDependencies, TOOLS);
    info.frontend = matchDeps(allDeps, Object.fromEntries(
      Object.entries(FRAMEWORKS).filter(([k]) => FRONTEND_KEYS.has(k))
    ));
    info.backend = matchDeps(allDeps, Object.fromEntries(
      Object.entries(FRAMEWORKS).filter(([k]) => BACKEND_KEYS.has(k))
    ));

    // Test framework from tools
    info.test = info.tools.filter(t => ['Vitest', 'Jest', 'Mocha', 'Playwright', 'Cypress'].includes(t));

    // 1b. Scan workspace packages (monorepo support)
    const fwFrontend = Object.fromEntries(Object.entries(FRAMEWORKS).filter(([k]) => FRONTEND_KEYS.has(k)));
    const fwBackend = Object.fromEntries(Object.entries(FRAMEWORKS).filter(([k]) => BACKEND_KEYS.has(k)));
    // Handle both array and object ({packages: [...]}) workspace formats
    const rawWs = pkg.workspaces;
    const workspaceList = Array.isArray(rawWs) ? rawWs
      : Array.isArray(rawWs?.packages) ? rawWs.packages : [];
    for (const ws of workspaceList) {
      const wsPkg = safeJsonRead(join(projectRoot, ws, 'package.json'));
      if (!wsPkg) continue;
      const wsDeps = { ...wsPkg.dependencies, ...wsPkg.devDependencies };
      pushUnique(info.frameworks, matchDeps(wsDeps, FRAMEWORKS));
      pushUnique(info.frontend, matchDeps(wsDeps, fwFrontend));
      pushUnique(info.backend, matchDeps(wsDeps, fwBackend));
      pushUnique(info.tools, matchDeps(wsDeps, TOOLS));
    }
  }

  // 2. Python project
  if (!pkg) {
    if (existsSync(join(projectRoot, 'pyproject.toml'))) {
      info.language = 'Python';
      const content = safeTextRead(join(projectRoot, 'pyproject.toml'));
      const nameMatch = content?.match(/^name\s*=\s*"(.+?)"/m);
      if (nameMatch) info.name = nameMatch[1];
    } else if (existsSync(join(projectRoot, 'requirements.txt'))) {
      info.language = 'Python';
    }
  }

  // 3. Go project
  if (!info.language && existsSync(join(projectRoot, 'go.mod'))) {
    info.language = 'Go';
    const content = safeTextRead(join(projectRoot, 'go.mod'));
    const modMatch = content?.match(/^module\s+(.+)/m);
    if (modMatch) info.name = modMatch[1].split('/').pop();
  }

  // 4. Rust project
  if (!info.language && existsSync(join(projectRoot, 'Cargo.toml'))) {
    info.language = 'Rust';
    const content = safeTextRead(join(projectRoot, 'Cargo.toml'));
    const nameMatch = content?.match(/^name\s*=\s*"(.+?)"/m);
    if (nameMatch) info.name = nameMatch[1];
  }

  // 5. Fallbacks
  if (!info.name) info.name = basename(projectRoot);

  if (!info.description) {
    const readme = safeTextRead(join(projectRoot, 'README.md'), 500);
    const h1 = readme?.match(/^#\s+(.+)/m);
    if (h1) info.description = h1[1].trim();
  }

  // 6. Infrastructure
  if (existsSync(join(projectRoot, 'Dockerfile'))) info.infra.push('Docker');
  if (existsSync(join(projectRoot, 'docker-compose.yml')) ||
      existsSync(join(projectRoot, 'docker-compose.yaml'))) info.infra.push('Docker Compose');
  try {
    const ghDir = join(projectRoot, '.github', 'workflows');
    if (existsSync(ghDir) && readdirSync(ghDir).length > 0) info.infra.push('GitHub Actions');
  } catch { /* no workflows dir */ }
  if (existsSync(join(projectRoot, '.gitlab-ci.yml'))) info.infra.push('GitLab CI');

  return info;
}

// ── Entity builder ──

export function buildEntities(info) {
  const projectName = toPascalCase(info.name);
  const date = todayISO();
  const techObs = [];
  const bizObs = [];

  // TECH observations
  const stackParts = [info.language, ...info.frameworks, info.moduleSystem].filter(Boolean);
  if (stackParts.length) techObs.push(obs(`STACK: ${stackParts.join(', ')}`));
  if (info.frontend.length) techObs.push(obs(`FRONTEND: ${info.frontend.join(', ')}`));
  if (info.backend.length) techObs.push(obs(`BACKEND: ${info.backend.join(', ')}`));
  if (info.tools.length) techObs.push(obs(`BUILD: ${info.tools.join(', ')}`));
  if (info.test.length) techObs.push(obs(`TEST: ${info.test.join(', ')}`));
  if (info.infra.length) techObs.push(obs(`INFRA: ${info.infra.join(', ')}`));

  // BIZ observations
  const desc = info.description || `Project at ${info.name}`;
  bizObs.push(obs(`WHAT: ${desc}`));
  const projParts = [info.name, info.language].filter(Boolean);
  bizObs.push(obs(`PROJECT: ${projParts.join(', ')}`));

  return {
    projectName,
    tech: { type: 'entity', name: `TECH:${projectName}`, entityType: 'tech-stack',
      observations: techObs, createdAt: Date.now() },
    biz: { type: 'entity', name: `BIZ:${projectName}`, entityType: 'biz-domain',
      observations: bizObs, createdAt: Date.now() },
    relation: { type: 'relation', from: `BIZ:${projectName}`,
      to: `TECH:${projectName}`, relationType: 'uses_tech' },
  };
}

// ── Main export ──

/** Scan project configuration into scoped candidates; caller must review before activation. */
export async function learnProject(projectRoot, options = {}) {
  if(!options || typeof options !== 'object')throw new Error('learnProject requires an options object; legacy path arguments are not supported');
  const {projectName,tech,biz}=buildEntities(scanProject(projectRoot));
  const store=options.store??new BrainStore({dbPath:resolvePaths().dbPath});
  try {
    const service=new MemoryService({store});
    let entities=0,observations=0;
    store.batch(()=>{
      service.startSession(projectRoot);
      const ids=[];
      for(const draft of [tech,biz]){
        const existing=store.getEntity({name:draft.name,projectId:service.projectId,lifecycles:['active','candidate','archived','rejected']});
        // Scanner inference never modifies reviewed or archived knowledge.
        if(existing&&existing.lifecycle!=='candidate')continue;
        const bodies=new Set((existing?.observations??[]).map(obsBody));
        const added=draft.observations.filter(o=>!bodies.has(obsBody(o)));
        const result=service.createEntities([{name:draft.name,entityType:draft.entityType,observations:added,lifecycle:'candidate',provenance:{source:'project-scanner',confidence:0.6}}])[0];
        if(!existing)entities++;observations+=added.length;ids.push(result.entity.id);
      }
      if(ids.length===2)service.createRelation(ids[1],ids[0],'uses_tech');
    });
    if(!options.silent)console.log('Scanned '+projectName+': '+entities+' candidate entities, '+observations+' observations (review required)');
    return {projectName,entities,observations,skipped:observations===0};
  } finally {if(!options.store)store.close();}
}
