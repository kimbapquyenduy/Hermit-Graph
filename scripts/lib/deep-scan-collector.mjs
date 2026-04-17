/**
 * deep-scan-collector.mjs — Deterministic Phase 0-3 collector for deep-scan.
 *
 * Extracts project identity, architecture, API surface, and data output
 * without AI reasoning. Returns structured data for AI Phase 4-8.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, basename, extname, relative } from 'path';
import { execSync } from 'child_process';
import { readBrain } from './brain-io.mjs';

// ── Helpers ──

function safeJsonRead(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function safeTextRead(filePath, maxChars = 4000) {
  try { return readFileSync(filePath, 'utf-8').slice(0, maxChars); } catch { return null; }
}

function safeReadLines(filePath, maxLines = 150) {
  try {
    const text = readFileSync(filePath, 'utf-8');
    return text.split('\n').slice(0, maxLines);
  } catch { return null; }
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function toPascalCase(str) {
  const clean = str.replace(/^@[^/]+\//, '');
  return clean.replace(/[-_.]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\s/g, '');
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  '.turbo', '.cache', '.parcel-cache', 'coverage', '__pycache__',
  '.venv', 'venv', 'vendor', 'target', '.svelte-kit',
]);

function listDirs(dir, depth = 1) {
  const result = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          result.push({ name: entry, path: full });
          if (depth > 1) {
            for (const sub of listDirs(full, depth - 1)) {
              result.push({ name: `${entry}/${sub.name}`, path: sub.path });
            }
          }
        }
      } catch { /* skip inaccessible */ }
    }
  } catch { /* skip inaccessible */ }
  return result;
}

function countFiles(dir) {
  let count = 0;
  try {
    for (const entry of readdirSync(dir)) {
      if (IGNORE_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isFile()) count++;
        else if (st.isDirectory()) count += countFiles(full);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return count;
}

function findFiles(dir, patterns, maxDepth = 3, _depth = 0) {
  const results = [];
  if (_depth >= maxDepth) return results;
  try {
    for (const entry of readdirSync(dir)) {
      if (IGNORE_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isFile()) {
          for (const p of patterns) {
            if (typeof p === 'string' ? entry === p : p.test(entry)) {
              results.push(full);
              break;
            }
          }
        } else if (st.isDirectory()) {
          results.push(...findFiles(full, patterns, maxDepth, _depth + 1));
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return results;
}

function gitLog(cwd, since) {
  try {
    return execSync(`git log --since="${since}" --stat --pretty=format:"%H"`, {
      cwd, encoding: 'utf-8', timeout: 10000,
    }).trim();
  } catch { return ''; }
}

function gitHead(cwd) {
  try {
    return execSync('git rev-parse HEAD', {
      cwd, encoding: 'utf-8', timeout: 5000,
    }).trim();
  } catch { return null; }
}

// ── Framework detection (shared with project-learner) ──

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

function matchDeps(deps, map) {
  if (!deps) return [];
  return Object.keys(deps).filter(k => map[k]).map(k => map[k]);
}

// ══════════════════════════════════════════════════════════════════════════
// Phase 0: Change Detection
// ══════════════════════════════════════════════════════════════════════════

export function phaseZero(cwd, brainPath, force = false) {
  // Detect project name
  const pkg = safeJsonRead(join(cwd, 'package.json'));
  const pyproject = safeTextRead(join(cwd, 'pyproject.toml'), 1000);
  let projectName;
  if (pkg?.name) projectName = toPascalCase(pkg.name);
  else if (pyproject) {
    const m = pyproject.match(/^name\s*=\s*"(.+?)"/m);
    projectName = m ? toPascalCase(m[1]) : toPascalCase(basename(cwd));
  } else {
    projectName = toPascalCase(basename(cwd));
  }

  if (force) {
    return { scanType: 'full', phasesToRun: [1, '1.5', 2, 3], projectName, noChanges: false };
  }

  // Check ScanMeta in brain
  const { entities } = readBrain(brainPath);
  const metaKey = `TECH:${projectName}:ScanMeta`;
  const meta = entities.get(metaKey);

  if (!meta) {
    return { scanType: 'full', phasesToRun: [1, '1.5', 2, 3], projectName, noChanges: false };
  }

  // Extract LAST_SCAN and GIT_HEAD from observations
  let lastScan = null;
  let storedHead = null;
  const storedDirs = {};
  for (const obs of meta.observations) {
    const text = typeof obs === 'string' ? obs : obs.content || '';
    const scanMatch = text.match(/LAST_SCAN:\s*(\S+)/);
    if (scanMatch) lastScan = scanMatch[1];
    const headMatch = text.match(/GIT_HEAD:\s*(\S+)/);
    if (headMatch) storedHead = headMatch[1];
    const dirMatch = text.match(/DIR:(\S+)\s*=\s*(\d+)/);
    if (dirMatch) storedDirs[dirMatch[1]] = parseInt(dirMatch[2]);
  }

  if (!lastScan) {
    return { scanType: 'full', phasesToRun: [1, '1.5', 2, 3], projectName, noChanges: false };
  }

  // Git-based detection
  const currentHead = gitHead(cwd);
  if (currentHead && storedHead && currentHead !== storedHead) {
    // Check if it's a rebase/force-push (stored head not in history)
    try {
      execSync(`git merge-base --is-ancestor ${storedHead} ${currentHead}`, {
        cwd, encoding: 'utf-8', timeout: 5000,
      });
    } catch {
      // Stored head not ancestor → force-push/rebase → full rescan
      return { scanType: 'full', phasesToRun: [1, '1.5', 2, 3], projectName, noChanges: false };
    }
  }

  const phases = new Set();
  const isGit = existsSync(join(cwd, '.git'));

  if (isGit && lastScan) {
    const log = gitLog(cwd, lastScan);
    if (log) {
      const files = log.split('\n').filter(l => l.includes('|')).map(l => l.trim().split(/\s+\|/)[0].trim());
      for (const f of files) {
        if (/package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml/.test(f)) phases.add(1);
        if (/README\.md|CLAUDE\.md|AGENTS\.md/.test(f)) { phases.add(1); phases.add('5.5'); }
        if (/docker-compose|\.github\/workflows|Makefile/.test(f)) { phases.add(1); phases.add(6); }
        if (/routes\/|controllers\/|api\/|pages\/|app\/api\//.test(f)) phases.add(3);
        if (/src\/|lib\/|app\//.test(f)) { phases.add(2); phases.add(4); phases.add(5); phases.add('6.5'); }
        if (/docs\/adr\/|docs\/decisions\/|decisions\//.test(f)) phases.add('5.5');
        if (/\.env|docker|webhook|queue/.test(f)) phases.add(6);
        if (/\.config\.|tsconfig|Dockerfile|vercel\.json|fly\.toml/.test(f)) phases.add(6);
        if (/CHANGELOG\.md|HISTORY\.md/.test(f)) phases.add('6.5');
      }
    }
  }

  // Dir-based detection (always check data dirs)
  const currentDirs = {};
  for (const d of listDirs(cwd, 1)) {
    currentDirs[d.name] = countFiles(d.path);
  }
  for (const [dir, count] of Object.entries(currentDirs)) {
    if (!(dir in storedDirs) || storedDirs[dir] !== count) {
      if (/src|lib|app/.test(dir)) { phases.add(2); phases.add(4); phases.add(5); }
      if (/routes|controllers|api/.test(dir)) phases.add(3);
      if (/plans|docs|reports/.test(dir)) { phases.add(1); phases.add(5); }
      if (/scripts/.test(dir)) { phases.add(1); phases.add(6); }
      if (!(dir in storedDirs)) phases.add(1);
    }
  }

  if (phases.size === 0) {
    return { scanType: 'no-changes', phasesToRun: [], projectName, noChanges: true, lastScan };
  }

  return {
    scanType: 'incremental',
    phasesToRun: [...phases].sort(),
    projectName,
    noChanges: false,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Phase 1: Project Identity
// ══════════════════════════════════════════════════════════════════════════

export function phaseOne(cwd) {
  const identity = {
    name: null, description: null, language: null, moduleSystem: null,
    frameworks: [], tools: [], deps: {}, scripts: {},
    cicd: null, docker: null, envVars: [], readme: null,
  };

  // package.json
  const pkg = safeJsonRead(join(cwd, 'package.json'));
  if (pkg) {
    identity.name = pkg.name || basename(cwd);
    identity.description = pkg.description || null;
    identity.moduleSystem = pkg.type === 'module' ? 'ESM' : 'CJS';
    identity.language = existsSync(join(cwd, 'tsconfig.json')) ? 'TypeScript' : 'JavaScript';
    identity.scripts = pkg.scripts || {};
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    identity.frameworks = matchDeps(allDeps, FRAMEWORKS);
    identity.tools = matchDeps(allDeps, TOOLS);
    identity.deps = {
      production: Object.keys(pkg.dependencies || {}),
      dev: Object.keys(pkg.devDependencies || {}),
    };
  }

  // pyproject.toml
  if (!pkg) {
    const pyproj = safeTextRead(join(cwd, 'pyproject.toml'), 2000);
    if (pyproj) {
      identity.language = 'Python';
      const nameMatch = pyproj.match(/^name\s*=\s*"(.+?)"/m);
      if (nameMatch) identity.name = nameMatch[1];
    }
  }

  // Go / Rust fallbacks
  if (!identity.language) {
    const goMod = safeTextRead(join(cwd, 'go.mod'), 500);
    if (goMod) { identity.language = 'Go'; identity.name = goMod.match(/^module\s+(.+)/m)?.[1]?.split('/').pop(); }
    const cargo = safeTextRead(join(cwd, 'Cargo.toml'), 500);
    if (cargo) { identity.language = 'Rust'; identity.name = cargo.match(/^name\s*=\s*"(.+?)"/m)?.[1]; }
  }

  if (!identity.name) identity.name = basename(cwd);

  // README (first 500 chars for description)
  const readme = safeTextRead(join(cwd, 'README.md'), 2000);
  if (readme) {
    identity.readme = readme;
    if (!identity.description) {
      const h1 = readme.match(/^#\s+(.+)/m);
      if (h1) identity.description = h1[1].trim();
    }
  }

  // .env.example
  const envFile = safeTextRead(join(cwd, '.env.example')) || safeTextRead(join(cwd, '.env.sample'));
  if (envFile) {
    identity.envVars = envFile.split('\n')
      .filter(l => l.match(/^[A-Z_]+=/) && !l.startsWith('#'))
      .map(l => l.split('=')[0].trim())
      .slice(0, 30);
  }

  // Docker
  const compose = safeTextRead(join(cwd, 'docker-compose.yml')) || safeTextRead(join(cwd, 'docker-compose.yaml'));
  if (compose) {
    const services = [...compose.matchAll(/^\s{2}(\w[\w-]*):\s*$/gm)].map(m => m[1]);
    identity.docker = { services, hasDockerfile: existsSync(join(cwd, 'Dockerfile')) };
  }

  // CI/CD
  const ghWorkflows = join(cwd, '.github', 'workflows');
  if (existsSync(ghWorkflows)) {
    try {
      identity.cicd = { tool: 'GitHub Actions', files: readdirSync(ghWorkflows).filter(f => f.endsWith('.yml') || f.endsWith('.yaml')) };
    } catch { /* skip */ }
  }
  if (!identity.cicd && existsSync(join(cwd, '.gitlab-ci.yml'))) {
    identity.cicd = { tool: 'GitLab CI', files: ['.gitlab-ci.yml'] };
  }

  return identity;
}

// ══════════════════════════════════════════════════════════════════════════
// Phase 1.5: Data Output Scanning
// ══════════════════════════════════════════════════════════════════════════

const DATA_DIR_PATTERNS = [
  /.*-txt$/, /.*-exports?$/, /^trimmed$/, /.*-dump.*/, /^output$/, /^data$/,
  /^exports$/, /^plans$/, /^docs$/, /^reports$/,
];

function isDataDir(name) {
  return DATA_DIR_PATTERNS.some(p => p.test(name));
}

export function phaseOneHalf(cwd) {
  const dataDirs = [];
  const samples = [];

  for (const d of listDirs(cwd, 1)) {
    if (!isDataDir(d.name)) continue;
    const fileCount = countFiles(d.path);
    if (fileCount < 3) continue;

    // Classify by extension
    const files = [];
    try {
      for (const f of readdirSync(d.path)) {
        const full = join(d.path, f);
        try { if (statSync(full).isFile()) files.push(f); } catch { /* skip */ }
      }
    } catch { continue; }

    const exts = {};
    for (const f of files) {
      const ext = extname(f).toLowerCase();
      exts[ext] = (exts[ext] || 0) + 1;
    }
    const dominantExt = Object.entries(exts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    dataDirs.push({
      name: d.name,
      fileCount,
      dominantExt,
      extBreakdown: exts,
    });

    // Sample up to 5 files
    const toSample = files.slice(0, 5);
    for (const f of toSample) {
      const lines = safeReadLines(join(d.path, f), 150);
      if (lines) {
        samples.push({
          dir: d.name,
          file: f,
          lines: lines.length,
          preview: lines.slice(0, 20).join('\n'),
        });
      }
      if (samples.length >= 10) break;
    }
  }

  return { dirs: dataDirs, samples };
}

// ══════════════════════════════════════════════════════════════════════════
// Phase 2: Architecture Mapping
// ══════════════════════════════════════════════════════════════════════════

export function phaseTwo(cwd) {
  const architecture = {
    dirs: [],
    entryPoints: [],
    configFiles: [],
    routingDirs: [],
  };

  // Directory structure (2 levels)
  architecture.dirs = listDirs(cwd, 2).map(d => d.name);

  // Entry points
  const entryPatterns = [
    /^main\.\w+$/, /^app\.\w+$/, /^index\.\w+$/, /^server\.\w+$/,
    /^mod\.rs$/, /^main\.go$/,
  ];
  for (const d of ['', 'src', 'app', 'lib']) {
    const dir = d ? join(cwd, d) : cwd;
    if (!existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir)) {
        if (entryPatterns.some(p => p.test(f))) {
          architecture.entryPoints.push(d ? `${d}/${f}` : f);
        }
      }
    } catch { /* skip */ }
  }

  // Config files
  const configPatterns = [
    'tsconfig.json', 'jsconfig.json', 'biome.json', '.prettierrc',
    'vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.mjs',
    'webpack.config.js', 'rollup.config.js', 'esbuild.config.js',
    '.eslintrc.js', '.eslintrc.json', 'eslint.config.js',
    'tailwind.config.js', 'tailwind.config.ts', 'postcss.config.js',
    'vercel.json', 'fly.toml', 'Dockerfile',
  ];
  for (const cf of configPatterns) {
    if (existsSync(join(cwd, cf))) architecture.configFiles.push(cf);
  }

  // Routing directories
  const routeDirs = ['routes', 'router', 'controllers', 'pages', 'app/api', 'src/routes', 'src/pages', 'src/app'];
  for (const rd of routeDirs) {
    if (existsSync(join(cwd, rd))) architecture.routingDirs.push(rd);
  }

  return architecture;
}

// ══════════════════════════════════════════════════════════════════════════
// Phase 3: API Routes & Schema
// ══════════════════════════════════════════════════════════════════════════

const ROUTE_PATTERNS = [
  // Express/Fastify/Koa: router.get('/path', handler)
  /\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  // NestJS decorators: @Get('/path')
  /@(Get|Post|Put|Patch|Delete|All)\s*\(\s*['"`]([^'"`]*?)['"`]\s*\)/gi,
  // Next.js App Router: export async function GET/POST
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/gi,
  // Hono: app.get('/path', handler)
  /app\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
];

function extractRoutes(fileContent, filePath) {
  const routes = [];
  for (const pattern of ROUTE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(fileContent)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2] || filePath; // Next.js has no path in decorator
      routes.push({ method, path, file: filePath });
    }
  }
  return routes;
}

export function phaseThree(cwd) {
  const apiSurface = { routes: [], models: [], schemas: [] };

  // Find route files
  const routeFiles = findFiles(cwd, [
    /route\.\w+$/, /routes?\.\w+$/, /controller\.\w+$/, /\.controller\.\w+$/,
    /\+server\.\w+$/, // SvelteKit
  ], 4);

  for (const rf of routeFiles.slice(0, 30)) {
    const content = safeTextRead(rf, 8000);
    if (!content) continue;
    const relPath = relative(cwd, rf).replace(/\\/g, '/');
    const routes = extractRoutes(content, relPath);
    apiSurface.routes.push(...routes);
  }

  // Find schema/model files
  const schemaFiles = findFiles(cwd, [
    /schema\.prisma$/, /\.model\.\w+$/, /\.entity\.\w+$/,
    /schema\.\w+$/, /drizzle.*\.ts$/, /migration.*\.\w+$/,
  ], 4);

  for (const sf of schemaFiles.slice(0, 15)) {
    const content = safeTextRead(sf, 6000);
    if (!content) continue;
    const relPath = relative(cwd, sf).replace(/\\/g, '/');

    // Prisma models
    const prismaModels = [...content.matchAll(/model\s+(\w+)\s*\{([^}]+)\}/g)];
    for (const m of prismaModels) {
      const fields = m[2].split('\n').filter(l => l.trim() && !l.trim().startsWith('//')).map(l => l.trim()).slice(0, 15);
      apiSurface.models.push({ name: m[1], file: relPath, fields });
    }

    // Drizzle tables
    const drizzleTables = [...content.matchAll(/export\s+const\s+(\w+)\s*=\s*\w+Table\s*\(\s*['"`](\w+)['"`]/g)];
    for (const t of drizzleTables) {
      apiSurface.models.push({ name: t[2], file: relPath, fields: [] });
    }

    apiSurface.schemas.push(relPath);
  }

  return apiSurface;
}

// ══════════════════════════════════════════════════════════════════════════
// Phase 4-6 Hints: Business logic, conventions, integration file detection
// ══════════════════════════════════════════════════════════════════════════

/**
 * Detect candidate files for AI Phase 4 (conventions), Phase 5 (biz rules),
 * and Phase 6 (integrations). Returns file paths grouped by category so AI
 * knows WHERE to look — deterministic discovery, AI does the extraction.
 */
export function phaseFourFiveSixHints(cwd) {
  const hints = {
    // Phase 4: source files for convention detection
    sourceFiles: [],
    // Phase 5: business logic candidate files
    services: [],
    validators: [],
    constants: [],
    policies: [],
    testFiles: [],
    businessMd: null,
    // Phase 6: integration candidate files
    webhooks: [],
    queues: [],
    sdkClients: [],
    envFiles: [],
  };

  // BUSINESS.md
  const bizMd = join(cwd, 'BUSINESS.md');
  if (existsSync(bizMd)) hints.businessMd = 'BUSINESS.md';

  // Service layer files
  hints.services = findFiles(cwd, [
    /\.service\.\w+$/, /\.usecase\.\w+$/, /\.handler\.\w+$/,
  ], 4).map(f => relative(cwd, f).replace(/\\/g, '/'));

  // Also check service directories
  for (const dir of ['services', 'usecases', 'domain', 'src/services', 'src/domain', 'src/usecases', 'lib/services']) {
    const full = join(cwd, dir);
    if (existsSync(full)) {
      const files = findFiles(full, [/\.\w+$/], 2);
      for (const f of files.slice(0, 20)) {
        const rel = relative(cwd, f).replace(/\\/g, '/');
        if (!hints.services.includes(rel)) hints.services.push(rel);
      }
    }
  }
  hints.services = hints.services.slice(0, 30);

  // Validation / DTO files
  hints.validators = findFiles(cwd, [
    /\.dto\.\w+$/, /\.validator\.\w+$/, /\.validation\.\w+$/,
    /\.guard\.\w+$/, /\.pipe\.\w+$/,
  ], 4).map(f => relative(cwd, f).replace(/\\/g, '/')).slice(0, 20);

  // Constants / enum files
  hints.constants = findFiles(cwd, [
    /^constants\.\w+$/, /^enums?\.\w+$/, /\.constants?\.\w+$/,
    /\.enums?\.\w+$/, /^config\.\w+$/,
  ], 3).map(f => relative(cwd, f).replace(/\\/g, '/')).slice(0, 15);

  // Policy / middleware / permission files
  hints.policies = findFiles(cwd, [
    /\.policy\.\w+$/, /\.middleware\.\w+$/, /\.permission\.\w+$/,
    /\.auth\.\w+$/, /\.acl\.\w+$/,
  ], 4).map(f => relative(cwd, f).replace(/\\/g, '/')).slice(0, 15);

  // Test files (for behavioral specs extraction)
  hints.testFiles = findFiles(cwd, [
    /\.test\.\w+$/, /\.spec\.\w+$/, /\.e2e\.\w+$/,
    /test-[\w-]+\.\w+$/,
  ], 4).map(f => relative(cwd, f).replace(/\\/g, '/')).slice(0, 20);

  // Webhook / callback handlers
  hints.webhooks = findFiles(cwd, [
    /webhook/i, /callback/i,
  ], 3).map(f => relative(cwd, f).replace(/\\/g, '/')).slice(0, 10);

  // Queue / worker files
  hints.queues = findFiles(cwd, [
    /queue/i, /worker\.\w+$/, /consumer\.\w+$/, /producer\.\w+$/,
    /\.job\.\w+$/, /\.cron\.\w+$/,
  ], 3).map(f => relative(cwd, f).replace(/\\/g, '/')).slice(0, 10);

  // SDK / API client files
  hints.sdkClients = findFiles(cwd, [
    /[\w-]*client\.\w+$/, /[\w-]*sdk\.\w+$/, /api-client/i,
    /[\w-]*-api\.\w+$/,
  ], 3).map(f => relative(cwd, f).replace(/\\/g, '/')).slice(0, 10);

  // Env files (for cross-ref)
  for (const envFile of ['.env.example', '.env.sample', '.env.development', '.env.local']) {
    if (existsSync(join(cwd, envFile))) hints.envFiles.push(envFile);
  }

  // Source files for convention detection (sample 20+ from src/lib/app)
  for (const dir of ['src', 'lib', 'app', 'scripts', 'pages', 'components']) {
    const full = join(cwd, dir);
    if (!existsSync(full)) continue;
    const files = findFiles(full, [
      /\.(js|ts|mjs|cjs|jsx|tsx|py|go|rs)$/,
    ], 3);
    for (const f of files.slice(0, 10)) {
      hints.sourceFiles.push(relative(cwd, f).replace(/\\/g, '/'));
    }
    if (hints.sourceFiles.length >= 30) break;
  }
  hints.sourceFiles = hints.sourceFiles.slice(0, 30);

  return hints;
}

// ══════════════════════════════════════════════════════════════════════════
// Main collector: run all deterministic phases
// ══════════════════════════════════════════════════════════════════════════

/**
 * Run deterministic Phase 0-3 and return structured scan data.
 * @param {string} cwd — project root
 * @param {string} brainPath — path to brain.jsonl
 * @param {object} [opts]
 * @param {boolean} [opts.force] — force full rescan
 * @returns {object} Structured scan result for AI Phase 4-8
 */
export function collectScanData(cwd, brainPath, opts = {}) {
  const phase0 = phaseZero(cwd, brainPath, opts.force);

  if (phase0.noChanges) {
    return {
      scanType: 'no-changes',
      projectName: phase0.projectName,
      lastScan: phase0.lastScan,
      phasesToRun: [],
      identity: null,
      architecture: null,
      apiSurface: null,
      dataOutput: null,
    };
  }

  const shouldRun = (p) => phase0.scanType === 'full' || phase0.phasesToRun.includes(p);

  const identity = shouldRun(1) ? phaseOne(cwd) : null;
  const dataOutput = phaseOneHalf(cwd);  // always runs if data dirs exist
  const architecture = shouldRun(2) ? phaseTwo(cwd) : null;
  const apiSurface = shouldRun(3) ? phaseThree(cwd) : null;
  const bizHints = phaseFourFiveSixHints(cwd);  // always collect file hints for AI

  // AI phases to run (4-8 always need AI reasoning)
  const aiPhases = [4, 5, '5.5', 6, '6.5', 7, '7.5', 8];
  const filteredAiPhases = phase0.scanType === 'full'
    ? aiPhases
    : aiPhases.filter(p => {
        // Map code phases to AI phases that depend on them
        if (phase0.phasesToRun.includes(4) || phase0.phasesToRun.includes(5)) return true;
        if (p === '5.5' && phase0.phasesToRun.includes('5.5')) return true;
        if (p === 6 && phase0.phasesToRun.includes(6)) return true;
        if (p === '6.5' && phase0.phasesToRun.includes('6.5')) return true;
        // Phase 7, 7.5, 8 always run on incremental
        if (p === 7 || p === '7.5' || p === 8) return true;
        return false;
      });

  return {
    scanType: phase0.scanType,
    projectName: phase0.projectName,
    phasesToRun: filteredAiPhases,
    identity,
    architecture,
    apiSurface,
    dataOutput: dataOutput.dirs.length > 0 ? dataOutput : null,
    bizHints,
  };
}
