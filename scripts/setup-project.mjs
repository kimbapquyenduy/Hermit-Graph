#!/usr/bin/env node

/**
 * Setup Hermit Graph for a new project.
 *
 * Supports multiple AI agents — not just Claude Code.
 * Auto-configures MCP memory, hooks, skills based on target agent.
 *
 * Usage:
 *   hermit setup                              # Auto-detect agent or default to Claude
 *   hermit setup --agent cursor               # Setup for Cursor
 *   hermit setup --agent windsurf             # Setup for Windsurf
 *   hermit setup --agent cline                # Setup for Cline (VS Code extension)
 *   hermit setup --agent codex                # Setup for OpenAI Codex CLI
 *   hermit setup --agent opencode             # Setup for OpenCode
 *   hermit setup --mcp-only                   # MCP config only (any agent)
 *   hermit setup --list                       # List available skills
 *   hermit setup --only biz-guard,api-design  # Install only selected skills (Claude)
 *   hermit setup --skip db-migrations         # Install all except skipped (Claude)
 *   hermit setup --skip-learn                 # Skip auto-learning project identity
 */

import { existsSync, mkdirSync, copyFileSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {resolvePaths} from './lib/storage/paths.mjs';
import {BrainStore} from './lib/storage/brain-store.mjs';
import { exportAllHooks } from './lib/hook-export.mjs';
import { exportAllCommands } from './lib/skill-export.mjs';
import { learnProject, scanProject } from './lib/project-learner.mjs';
import { writeBusinessMdIfMissing } from './lib/business-md-generator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const brainRoot = join(__dirname,'..');
const getPackageRoot=()=>brainRoot;
// HERMIT_USER_CWD is set by brain-cli when forking (preserves caller's cwd),
// since brain-cli forks with cwd=ROOT for deterministic module resolution.
const projectRoot = process.env.HERMIT_USER_CWD || process.cwd();
const args = process.argv.slice(2);
const userHome = process.env.USERPROFILE || process.env.HOME || '';

// Canonical user SQLite data root, independent of installation or caller cwd.
const storagePaths = resolvePaths();
const brainDataDir = storagePaths.dataRoot.replaceAll('\\','/');

// MCP server config (shared across all agents) — v4: native hermit-mcp-server
const hermitServerPath = join(getPackageRoot(), 'scripts', 'hermit-mcp-server.mjs').replace(/\\/g, '/');
const MCP_SERVER_CONFIG = {
  command: 'node',
  args: [hermitServerPath],
  env: {
    HERMIT_DATA_DIR: brainDataDir,
    HF_HUB_DISABLE_SYMLINKS_WARNING: '1'
  }
};

// Cline settings path (needed by AGENTS definition)
function getClineMcpSettingsPath() {
  const appData = process.env.APPDATA
    || (process.platform === 'darwin'
      ? join(userHome, 'Library', 'Application Support')
      : join(userHome, '.config'));
  return join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
}

// ══════════════════════════════════════════════════════════════════════════
// AGENT DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════

const AGENTS = {
  claude: {
    name: 'Claude Code',
    configDir: '.claude',
    globalConfigPath: () => join(userHome, '.claude', 'settings.json'),
    projectConfigPath: () => join(projectRoot, '.claude', 'settings.json'),
    supportsSkills: true,
    supportsCommands: true,
    supportsHooks: true,
    configureGlobalMcp,
    configureProjectMcp: configureClaudeProject,
    nextSteps: [
      '1. Edit BUSINESS.md with your project business rules',
      '2. Edit CLAUDE.md with your tech stack and build commands',
      '3. Restart Claude Code — it now has memory!',
    ],
    commandsHelp: [
      '/impact      — Analyze blast radius before code changes',
      '/biz-review  — Review code vs business rules',
      '/remember    — Save knowledge to memory',
      '/recall      — Search saved knowledge',
    ],
  },
  cursor: {
    name: 'Cursor',
    configDir: '.cursor',
    globalConfigPath: () => join(userHome, '.cursor', 'mcp.json'),
    projectConfigPath: () => join(projectRoot, '.cursor', 'mcp.json'),
    supportsSkills: false,
    supportsCommands: false,
    supportsHooks: false,
    rulesFile: () => join(projectRoot, '.cursor', 'rules', 'hermit.mdc'),
    rulesFormat: 'mdc',
    configureGlobalMcp: configureCursorGlobalMcp,
    configureProjectMcp: configureCursorProjectMcp,
    nextSteps: [
      '1. Edit BUSINESS.md with your project business rules',
      '2. Restart Cursor — it now has memory via MCP!',
      '3. Agent will auto-load context via hermit_session_start (see .cursor/rules/hermit.mdc)',
    ],
    commandsHelp: [
      'MCP tools: search_nodes, create_entities, open_nodes, create_relations',
      'Session: hermit_session_start loads project context automatically',
    ],
  },
  windsurf: {
    name: 'Windsurf',
    configDir: null,
    globalConfigPath: () => join(userHome, '.codeium', 'windsurf', 'mcp_config.json'),
    projectConfigPath: () => null,
    supportsSkills: false,
    supportsCommands: false,
    supportsHooks: false,
    rulesFile: () => join(projectRoot, '.windsurfrules'),
    rulesFormat: 'append',
    configureGlobalMcp: configureWindsurfGlobalMcp,
    configureProjectMcp: () => {},
    nextSteps: [
      '1. Edit BUSINESS.md with your project business rules',
      '2. Restart Windsurf — it now has memory via MCP!',
      '3. Agent will auto-load context via hermit_session_start',
    ],
    commandsHelp: [
      'MCP tools: search_nodes, create_entities, open_nodes, create_relations',
      'Session: hermit_session_start loads project context automatically',
    ],
  },
  cline: {
    name: 'Cline (VS Code)',
    configDir: null,
    globalConfigPath: () => getClineMcpSettingsPath(),
    projectConfigPath: () => null,
    supportsSkills: false,
    supportsCommands: false,
    supportsHooks: false,
    rulesFile: () => join(projectRoot, '.clinerules'),
    rulesFormat: 'file',
    configureGlobalMcp: configureClineGlobalMcp,
    configureProjectMcp: () => {},
    nextSteps: [
      '1. Edit BUSINESS.md with your project business rules',
      '2. Restart VS Code — Cline now has memory via MCP!',
    ],
    commandsHelp: [
      'MCP tools: search_nodes, create_entities, open_nodes, create_relations',
      'Session: hermit_session_start loads project context automatically',
    ],
  },
  codex: {
    name: 'OpenAI Codex CLI',
    configDir: null,
    globalConfigPath: () => join(userHome, '.codex', 'config.toml'),
    projectConfigPath: () => null,
    supportsSkills: false,
    supportsCommands: false,
    supportsHooks: false,
    rulesFile: () => join(projectRoot, 'AGENTS.md'),
    rulesFormat: 'file',
    configureGlobalMcp: configureCodexGlobalMcp,
    configureProjectMcp: () => {},
    nextSteps: [
      '1. Edit BUSINESS.md with your project business rules',
      '2. Restart Codex CLI — it now has memory via MCP!',
    ],
    commandsHelp: [
      'MCP tools: search_nodes, create_entities, open_nodes, create_relations',
      'Session: hermit_session_start loads project context automatically',
    ],
  },
  opencode: {
    name: 'OpenCode',
    configDir: '.opencode',
    globalConfigPath: () => join(userHome, '.opencode', 'config.json'),
    projectConfigPath: () => join(projectRoot, 'opencode.json'),
    supportsSkills: false,
    supportsCommands: false,
    supportsHooks: false,
    rulesFile: () => join(projectRoot, 'AGENTS.md'),
    rulesFormat: 'file',
    configureGlobalMcp: configureOpenCodeGlobalMcp,
    configureProjectMcp: configureOpenCodeProjectMcp,
    nextSteps: [
      '1. Edit BUSINESS.md with your project business rules',
      '2. Restart OpenCode — it now has memory via MCP!',
    ],
    commandsHelp: [
      'MCP tools: search_nodes, create_entities, open_nodes, create_relations',
      'Session: hermit_session_start loads project context automatically',
    ],
  },
};

// ══════════════════════════════════════════════════════════════════════════
// DETECT OR PARSE AGENT
// ══════════════════════════════════════════════════════════════════════════

function detectAgent() {
  // Explicit --agent flag
  const agentIdx = args.indexOf('--agent');
  if (agentIdx !== -1 && args[agentIdx + 1]) {
    const name = args[agentIdx + 1].toLowerCase();
    if (name === 'all') return 'all';
    if (AGENTS[name]) return name;
    console.log(`Warning: unknown agent "${name}". Supported: ${Object.keys(AGENTS).join(', ')}, all`);
    console.log('Falling back to all agents.\n');
    return 'all';
  }

  // --mcp-only flag = generic MCP setup
  if (args.includes('--mcp-only')) return 'mcp-only';

  // Default: setup ALL agents (zero-config experience)
  return 'all';
}

const isMcpOnly = args.includes('--mcp-only');
const agentKey = isMcpOnly ? 'mcp-only' : detectAgent();
const agent = AGENTS[agentKey] || null;

// ══════════════════════════════════════════════════════════════════════════
// DISCOVER SKILLS
// ══════════════════════════════════════════════════════════════════════════

const catalog = join(brainRoot, 'catalog');
const skillsDir = join(catalog, 'skills');
const allSkills = existsSync(skillsDir)
  ? readdirSync(skillsDir).filter(d => existsSync(join(skillsDir, d, 'SKILL.md')))
  : [];

// --list: show skills and exit
if (args.includes('--list')) {
  console.log('Available skills in Hermit Graph:\n');
  for (const skill of allSkills) {
    const content = readFileSync(join(skillsDir, skill, 'SKILL.md'), 'utf-8');
    const title = content.split('\n').find(l => l.startsWith('# '))?.replace('# ', '') || skill;
    console.log(`  ${skill.padEnd(20)} — ${title}`);
  }
  console.log(`\nTotal: ${allSkills.length} skills`);
  console.log('\nOptions:');
  console.log('  --agent <name>         Target agent (claude, cursor, windsurf, cline, codex, opencode, all)');
  console.log('  --mcp-only             MCP config only (any agent)');
  console.log('  --only skill1,skill2   Install only selected skills (Claude only)');
  console.log('  --skip skill1,skill2   Install all except skipped skills (Claude only)');
  process.exit(0);
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN SETUP
// ══════════════════════════════════════════════════════════════════════════

let installed = 0;
let skipped = 0;

if (isMcpOnly) {
  // ── MCP-only mode: just configure MCP + SQLite brain.db ──
  console.log('Hermit Graph — MCP-Only Setup');
  console.log(`Project: ${projectRoot}`);
  console.log(`Brain:   ${brainDataDir}`);
  console.log('');

  ensureBrainStore();
  printMcpConfig();
  copyBusinessTemplate();

  console.log('');
  console.log(`Done! ${installed} items configured.`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Add the MCP config above to your AI agent settings');
  console.log('  2. Edit BUSINESS.md with your project business rules');
  console.log('  3. Restart your AI agent — it now has memory!');
  process.exit(0);
}

if (agentKey === 'all') {
  // ── Setup ALL agents automatically ──
  await setupAllAgents();
  process.exit(0);
}

// ── Single agent setup ──
await setupSingleAgent(agentKey);

// ══════════════════════════════════════════════════════════════════════════
// SETUP ALL AGENTS
// ══════════════════════════════════════════════════════════════════════════

async function setupAllAgents() {
  console.log('Hermit Graph — Full Setup (all agents)');
  console.log(`Project: ${projectRoot}`);
  console.log(`Brain:   ${brainDataDir}`);
  console.log('');

  // 1. Shared: SQLite brain.db + templates
  ensureBrainStore();
  ensureBridgesConfig();
  const projectInfo = scanProject(projectRoot);
  copyBusinessTemplate(AGENTS.claude, projectInfo);

  // 1b. Auto-learn project identity
  if (!args.includes('--skip-learn')) {
    console.log('\n── Auto-Learn ──');
    await learnProject(projectRoot);
  }

  // 2. Claude Code (full: MCP + skills + commands + hooks + CLAUDE.md)
  console.log('\n── Claude Code ──');
  const claude = AGENTS.claude;
  claude.configureGlobalMcp();
  claude.configureProjectMcp();
  installClaudeSkills(resolveSkillSelection());
  installClaudeCommands();
  installClaudeHooks();
  setupClaudeMd();
  setupGlobalClaudeMd();

  // 3. Cursor (MCP + rules + hooks + commands via export)
  console.log('\n── Cursor ──');
  configureCursorProjectMcp();
  installRulesFileFor('cursor');
  exportHooksAndCommandsFor('cursor');  // handles global MCP + hooks + commands

  // 4. Windsurf (MCP + rules + commands/skills export)
  console.log('\n── Windsurf ──');
  configureWindsurfGlobalMcp();
  installRulesFileFor('windsurf');
  exportHooksAndCommandsFor('windsurf');

  // 5. Cline (auto-write MCP config)
  console.log('\n── Cline ──');
  configureClineGlobalMcp();
  installRulesFileFor('cline');
  exportHooksAndCommandsFor('cline');

  // 6. Codex (auto-write config.toml)
  console.log('\n── Codex ──');
  configureCodexGlobalMcp();
  installRulesFileFor('codex');

  // 7. OpenCode (MCP + rules + commands export)
  console.log('\n── OpenCode ──');
  configureOpenCodeGlobalMcp();
  configureOpenCodeProjectMcp();
  installRulesFileFor('opencode');
  exportHooksAndCommandsFor('opencode');

  // Summary
  console.log('');
  console.log(`Done! ${installed} items configured, ${skipped} already existed.`);
  console.log('');
  console.log('All agents configured. Restart each IDE/agent to activate.');
  console.log('Edit BUSINESS.md with your project business rules.');
  console.log('');
  console.log('For full project mastery, run /deep-scan in your first AI session.');
  console.log('  This teaches your agent: business rules, API surface, data models, architecture.');
}

// ══════════════════════════════════════════════════════════════════════════
// SETUP SINGLE AGENT
// ══════════════════════════════════════════════════════════════════════════

async function setupSingleAgent(key) {
  const ag = AGENTS[key];
  console.log(`Hermit Graph — ${ag.name} Setup`);
  console.log(`Project: ${projectRoot}`);
  console.log(`Brain:   ${brainDataDir}`);
  const selectedSkills = ag.supportsSkills ? resolveSkillSelection() : [];
  if (ag.supportsSkills) {
    console.log(`Skills:  ${selectedSkills.length}/${allSkills.length} selected`);
  }
  console.log('');

  ensureBrainStore();
  ensureBridgesConfig();
  const projectInfo = scanProject(projectRoot);

  // Auto-learn project identity
  if (!args.includes('--skip-learn')) {
    console.log('── Auto-Learn ──');
    await learnProject(projectRoot);
    console.log('');
  }

  ag.configureGlobalMcp();
  ag.configureProjectMcp();

  if (ag.supportsSkills) installClaudeSkills(selectedSkills);
  if (ag.supportsCommands) installClaudeCommands();
  if (ag.supportsHooks) installClaudeHooks();

  copyBusinessTemplate(ag, projectInfo);

  if (!ag.supportsHooks && ag.rulesFile) installRulesFileFor(key);
  if (key === 'claude') { setupClaudeMd(); setupGlobalClaudeMd(); }
  if (key === 'cursor') exportHooksAndCommandsFor('cursor');
  if (key === 'cline') exportHooksAndCommandsFor('cline');
  if (key === 'windsurf') exportHooksAndCommandsFor('windsurf');
  if (key === 'opencode') exportHooksAndCommandsFor('opencode');

  console.log('');
  console.log(`Done! Installed ${installed} items, ${skipped} already existed.`);
  console.log('');
  console.log('Next steps:');
  for (const step of ag.nextSteps) console.log(`  ${step}`);
  console.log('');
  if (ag.commandsHelp.length) {
    console.log(ag.supportsCommands ? 'Key commands:' : 'Key MCP tools:');
    for (const cmd of ag.commandsHelp) console.log(`  ${cmd}`);
    console.log('');
  }
  console.log('For full project mastery, run /deep-scan in your first AI session.');
  console.log('  This teaches your agent: business rules, API surface, data models, architecture.');
}

function resolveSkillSelection() {
  let selected = [...allSkills];
  const onlyIdx = args.indexOf('--only');
  if (onlyIdx !== -1 && args[onlyIdx + 1]) {
    const only = args[onlyIdx + 1].split(',');
    selected = only.filter(s => allSkills.includes(s));
    const invalid = only.filter(s => !allSkills.includes(s));
    if (invalid.length) console.log(`Warning: skills not found: ${invalid.join(', ')}`);
  }
  const skipIdx = args.indexOf('--skip');
  if (skipIdx !== -1 && args[skipIdx + 1]) {
    const skip = args[skipIdx + 1].split(',');
    selected = selected.filter(s => !skip.includes(s));
  }
  return selected;
}

// ══════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ══════════════════════════════════════════════════════════════════════════

function ensureBrainStore() {
  const store=new BrainStore({dbPath:storagePaths.dbPath});
  store.close();
}

function ensureBridgesConfig() {
  if (!userHome) return;
  const hermitDir = join(userHome, '.hermit');
  const dst = join(hermitDir, 'mcp-bridges.json');
  if (!existsSync(dst)) {
    const src = join(brainRoot, 'templates', 'hermit', 'mcp-bridges.example.json');
    if (existsSync(src)) {
      if (!existsSync(hermitDir)) mkdirSync(hermitDir, { recursive: true });
      copyFileSync(src, dst);
      console.log('  + Created: ~/.hermit/mcp-bridges.json (all bridges disabled by default — safe to ignore)');
    }
  }
}

function copyBusinessTemplate(targetAgent = null, projectInfo = null) {
  // BUSINESS.md — use smart generation if project info available, else template copy
  const bizDst = join(projectRoot, 'BUSINESS.md');
  if (!existsSync(bizDst)) {
    if (projectInfo) {
      const result = writeBusinessMdIfMissing(projectRoot, projectInfo);
      if (result.created) {
        console.log('  + Generated: BUSINESS.md (pre-filled from project scan)');
        installed++;
      }
    } else {
      const src = join(brainRoot, 'templates/BUSINESS.md');
      if (existsSync(src)) {
        copyFileSync(src, bizDst);
        console.log('  + Template: BUSINESS.md — Edit with your project business rules');
        installed++;
      }
    }
  } else {
    skipped++;
  }

  // Test template — only for agents with slash commands
  if (targetAgent?.supportsCommands) {
    const testSrc = join(brainRoot, 'templates/tests/business-rules.test.template.ts');
    const testDst = join(projectRoot, 'tests/business-rules/rules.test.ts');
    if (existsSync(testSrc) && !existsSync(testDst)) {
      const dstDir = dirname(testDst);
      if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
      copyFileSync(testSrc, testDst);
      console.log('  + Template: tests/business-rules/rules.test.ts — Edit test assertions for your rules');
      installed++;
    } else if (existsSync(testDst)) {
      skipped++;
    }
  }
}

function installRulesFileFor(agentKey) {
  const ag = AGENTS[agentKey];
  if (!ag?.rulesFile) return;
  const dst = ag.rulesFile();
  if (!dst) return;

  const src = join(brainRoot, 'templates', 'hermit-rules.md');
  if (!existsSync(src)) return;

  const content = readFileSync(src, 'utf-8');

  if (ag.rulesFormat === 'mdc') {
    // Cursor MDC format: YAML frontmatter + content (always overwrite to stay current)
    const mdcContent = `---\ndescription: Hermit Graph persistent memory instructions\nglobs:\nalwaysApply: true\n---\n\n${content}`;
    const dstDir = dirname(dst);
    if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
    const existed = existsSync(dst);
    writeFileSync(dst, mdcContent);
    console.log(`  ${existed ? '~' : '+'} Rules: ${dst.replace(projectRoot, '.')}`);
    installed++;
  } else if (ag.rulesFormat === 'append') {
    let existing = existsSync(dst) ? readFileSync(dst, 'utf-8') : '';
    const startMarker = '<!-- hermit:rules start -->';
    const endMarker = '<!-- hermit:rules end -->';
    const markedContent = `${startMarker}\n${content}\n${endMarker}`;

    if (existing.includes(startMarker)) {
      existing = existing.replace(
        new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`),
        markedContent
      );
      writeFileSync(dst, existing);
      console.log(`  ~ Rules: updated in ${dst.replace(projectRoot, '.')}`);
      installed++;
    } else if (!existing.includes('Hermit Graph')) {
      const separator = existing ? '\n\n---\n\n' : '';
      writeFileSync(dst, existing + separator + markedContent);
      console.log(`  + Rules: appended to ${dst.replace(projectRoot, '.')}`);
      installed++;
    } else {
      skipped++;
    }
  } else {
    // Standalone file (Cline, Codex) — always overwrite to stay current
    const dstDir = dirname(dst);
    if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
    const existed = existsSync(dst);
    writeFileSync(dst, content);
    console.log(`  ${existed ? '~' : '+'} Rules: ${dst.replace(projectRoot, '.')}`);
    installed++;
  }
}

function printMcpConfig() {
  console.log('Add this to your AI agent MCP settings:\n');
  console.log(JSON.stringify({ mcpServers: { 'hermit-graph': MCP_SERVER_CONFIG } }, null, 2));
  console.log('');
}

// ══════════════════════════════════════════════════════════════════════════
// CLAUDE CODE — full setup
// ══════════════════════════════════════════════════════════════════════════

function configureGlobalMcp() {
  if (!userHome) return;

  const globalSettingsPath = join(userHome, '.claude', 'settings.json');
  try {
    let globalSettings = {};
    if (existsSync(globalSettingsPath)) {
      try { globalSettings = JSON.parse(readFileSync(globalSettingsPath, 'utf-8')); } catch { /* JSONC or corrupt — start fresh */ }
    }

    // Add MCP memory server if not configured
    if (!globalSettings.mcpServers) globalSettings.mcpServers = {};
    const hermitServer = globalSettings.mcpServers['hermit-graph'];
    const needsConfig = !hermitServer
      || !hermitServer.env?.HERMIT_DATA_DIR
      || hermitServer.env.HERMIT_DATA_DIR.includes('__HERMIT_DATA_DIR__');

    if (needsConfig) {
      // Remove legacy 'memory' key if present
      delete globalSettings.mcpServers.memory;
      globalSettings.mcpServers['hermit-graph'] = MCP_SERVER_CONFIG;
      const globalDir = dirname(globalSettingsPath);
      if (!existsSync(globalDir)) mkdirSync(globalDir, { recursive: true });
      writeFileSync(globalSettingsPath, JSON.stringify(globalSettings, null, 2));
      console.log('  + Configured: ~/.claude/settings.json (hermit-graph → SQLite brain.db)');
      installed++;
    }

    // Remove dead conventions MCP if present
    if (globalSettings.mcpServers.conventions) {
      delete globalSettings.mcpServers.conventions;
      writeFileSync(globalSettingsPath, JSON.stringify(globalSettings, null, 2));
      console.log('  ~ Cleaned: ~/.claude/settings.json (removed deprecated conventions MCP)');
    }

    // Register kg-pre-edit-impact PreToolUse hook GLOBALLY so it fires across all
    // Claude Code sessions (not just project-local). This closes the subagent-edit
    // gap where subagent Edit calls don't always route through project-scoped hooks.
    // Opt out with --skip-impact-guards.
    const skipImpactGuards = args.includes('--skip-impact-guards');
    if (!skipImpactGuards) {
      const settingsContent = JSON.stringify(globalSettings);
      if (!settingsContent.includes('kg-pre-edit-impact')) {
        if (!globalSettings.hooks) globalSettings.hooks = {};
        if (!globalSettings.hooks.PreToolUse) globalSettings.hooks.PreToolUse = [];
        // Use absolute path to hermit-graph install since hook is NOT per-project
        const hookAbsPath = join(brainRoot, 'catalog', 'hooks', 'kg-pre-edit-impact.cjs').replace(/\\/g, '/');
        globalSettings.hooks.PreToolUse.push({
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{
            type: 'command',
            command: `node "${hookAbsPath}"`,
          }],
        });
        writeFileSync(globalSettingsPath, JSON.stringify(globalSettings, null, 2));
        console.log('  ~ Updated: ~/.claude/settings.json (registered kg-pre-edit-impact GLOBAL hook)');
      }
    }
  } catch {
    console.log('  ! Warning: Could not auto-configure ~/.claude/settings.json');
    console.log(`    Add MCP memory manually with HERMIT_DATA_DIR = ${brainDataDir}`);
  }
}

function configureClaudeProject() {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  const claudeDir = join(projectRoot, '.claude');
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  if (!existsSync(settingsPath)) {
    // Create from template with correct SQLite brain.db path
    const tmpl = join(brainRoot, '.claude-settings.json');
    if (existsSync(tmpl)) {
      const config=JSON.parse(readFileSync(tmpl,'utf8'));
      config.mcpServers??={};delete config.mcpServers.memory;
      config.mcpServers['hermit-graph']=MCP_SERVER_CONFIG;
      writeFileSync(settingsPath,JSON.stringify(config,null,2));
      console.log('  + Created: .claude/settings.json (MCP memory + hooks configured)');
      installed++;
    } else {
      // Fallback: create a minimal settings.json so hook registration below can run
      writeFileSync(settingsPath, JSON.stringify({ mcpServers: {}, hooks: {} }, null, 2));
      console.log('  + Created: .claude/settings.json (minimal — hooks will be registered)');
      installed++;
    }
  }

  // Register both hooks (kg-auto-recall + kg-pre-edit-impact) in settings.json.
  // Runs whether the settings file was just created or already existed — idempotent.
  try {
    if (!existsSync(settingsPath)) return;
    const settingsContent = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsContent);
    let changed = false;

    // kg-auto-recall → UserPromptSubmit
    if (!settingsContent.includes('kg-auto-recall')) {
      if (!settings.hooks) settings.hooks = {};
      if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];
      let hookGroup = settings.hooks.UserPromptSubmit.find(g => g.hooks);
      if (!hookGroup) {
        hookGroup = { hooks: [] };
        settings.hooks.UserPromptSubmit.push(hookGroup);
      }
      hookGroup.hooks.unshift({
        type: 'command',
        command: 'node .claude/hooks/kg-auto-recall.cjs',
      });
      changed = true;
      console.log('  ~ Updated: .claude/settings.json (registered kg-auto-recall hook)');
    }

    // kg-pre-edit-impact → PreToolUse (Edit|Write|MultiEdit)
    // Opt out with --skip-impact-guards
    const skipImpactGuards = args.includes('--skip-impact-guards');
    if (!skipImpactGuards && !settingsContent.includes('kg-pre-edit-impact')) {
      if (!settings.hooks) settings.hooks = {};
      if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];
      settings.hooks.PreToolUse.push({
        matcher: 'Edit|Write|MultiEdit',
        hooks: [{
          type: 'command',
          command: 'node .claude/hooks/kg-pre-edit-impact.cjs',
        }],
      });
      changed = true;
      console.log('  ~ Updated: .claude/settings.json (registered kg-pre-edit-impact PreToolUse hook)');
    }

    if (changed) {
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }
  } catch { /* skip if settings.json can't be parsed */ }
}

function installClaudeSkills(skills) {
  for (const skill of skills) {
    const dir = join(projectRoot, '.claude', 'skills', skill);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const src = join(skillsDir, skill, 'SKILL.md');
    const dst = join(dir, 'SKILL.md');
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
      console.log(`  + Skill: ${skill}`);
      installed++;
    } else {
      skipped++;
    }
  }
}

function installClaudeCommands() {
  const commandsDir = join(catalog, 'commands');
  if (!existsSync(commandsDir)) return;

  const destDir = join(projectRoot, '.claude', 'commands');
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  for (const cmd of readdirSync(commandsDir)) {
    const src = join(commandsDir, cmd);
    const dst = join(destDir, cmd);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
      console.log(`  + Command: /${cmd.replace('.md', '')}`);
      installed++;
    } else {
      skipped++;
    }
  }
}

function installClaudeHooks() {
  const hooksDir = join(catalog, 'hooks');
  if (!existsSync(hooksDir)) return;

  const destDir = join(projectRoot, '.claude', 'hooks');
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  for (const hook of readdirSync(hooksDir)) {
    const src = join(hooksDir, hook);
    const dst = join(destDir, hook);
    // Recursively copy subdirectories (e.g., lib/ with shared hook modules)
    if (statSync(src).isDirectory()) {
      if (!existsSync(dst)) {
        cpSync(src, dst, { recursive: true });
        console.log(`  + Hook dir: ${hook}/`);
        installed++;
      } else {
        // Always update lib/ to keep shared modules current
        cpSync(src, dst, { recursive: true });
      }
      continue;
    }
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
      console.log(`  + Hook: ${hook}`);
      installed++;
    } else {
      skipped++;
    }
  }
}

function setupClaudeMd() {
  const claudeMd = join(projectRoot, 'CLAUDE.md');
  if (existsSync(claudeMd)) {
    const content = readFileSync(claudeMd, 'utf-8');
    if (!content.includes('BUSINESS.md')) {
      const appendix = `\n\n## Business Logic Guard\n- Read \`BUSINESS.md\` before modifying any business logic\n- Run \`/impact\` before changes affecting multiple modules\n- Run \`/biz-review\` after changes to verify business rules\n- Run \`/biz-init\` if project has no \`BUSINESS.md\` yet\n`;
      writeFileSync(claudeMd, content + appendix);
      console.log('  ~ Updated: CLAUDE.md (added biz-guard reference)');
    }
  } else {
    const tmpl = join(brainRoot, 'templates/CLAUDE.md');
    if (existsSync(tmpl)) {
      copyFileSync(tmpl, claudeMd);
      console.log('  + Created: CLAUDE.md — Edit for your project');
      installed++;
    }
  }
}

function setupGlobalClaudeMd() {
  if (!userHome) return;
  const globalClaudeMd = join(userHome, '.claude', 'CLAUDE.md');
  if (!existsSync(globalClaudeMd)) {
    const tmpl = join(brainRoot, 'templates', 'global-CLAUDE.md');
    if (existsSync(tmpl)) {
      const globalDir = dirname(globalClaudeMd);
      if (!existsSync(globalDir)) mkdirSync(globalDir, { recursive: true });
      copyFileSync(tmpl, globalClaudeMd);
      console.log('  + Created: ~/.claude/CLAUDE.md (global memory instructions)');
      installed++;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CURSOR — MCP config in .cursor/mcp.json
// ══════════════════════════════════════════════════════════════════════════

function configureCursorGlobalMcp() {
  if (!userHome) return;

  const globalMcpPath = join(userHome, '.cursor', 'mcp.json');
  try {
    let config = {};
    if (existsSync(globalMcpPath)) {
      try { config = JSON.parse(readFileSync(globalMcpPath, 'utf-8')); } catch { /* JSONC or corrupt — start fresh */ }
    }

    if (!config.mcpServers) config.mcpServers = {};
    if (!config.mcpServers['hermit-graph']) {
      // Remove legacy 'memory' key if present
      delete config.mcpServers.memory;
      config.mcpServers['hermit-graph'] = MCP_SERVER_CONFIG;
      const dir = dirname(globalMcpPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(globalMcpPath, JSON.stringify(config, null, 2));
      console.log('  + Configured: ~/.cursor/mcp.json (hermit-graph → SQLite brain.db)');
      installed++;
    }
  } catch {
    console.log('  ! Warning: Could not auto-configure ~/.cursor/mcp.json');
    printMcpConfig();
  }
}

function configureCursorProjectMcp() {
  const projectMcpPath = join(projectRoot, '.cursor', 'mcp.json');
  const cursorDir = join(projectRoot, '.cursor');

  // Create project-level MCP config for Cursor
  if (!existsSync(projectMcpPath)) {
    if (!existsSync(cursorDir)) mkdirSync(cursorDir, { recursive: true });
    const config = { mcpServers: { 'hermit-graph': MCP_SERVER_CONFIG } };
    writeFileSync(projectMcpPath, JSON.stringify(config, null, 2));
    console.log('  + Created: .cursor/mcp.json (hermit-graph MCP config)');
    installed++;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// WINDSURF — MCP config in ~/.codeium/windsurf/mcp_config.json
// ══════════════════════════════════════════════════════════════════════════

function configureWindsurfGlobalMcp() {
  if (!userHome) return;

  const windsurfConfigPath = join(userHome, '.codeium', 'windsurf', 'mcp_config.json');
  try {
    let config = {};
    if (existsSync(windsurfConfigPath)) {
      try { config = JSON.parse(readFileSync(windsurfConfigPath, 'utf-8')); } catch { /* JSONC or corrupt — start fresh */ }
    }

    if (!config.mcpServers) config.mcpServers = {};
    if (!config.mcpServers['hermit-graph']) {
      delete config.mcpServers.memory;
      config.mcpServers['hermit-graph'] = MCP_SERVER_CONFIG;
      const dir = dirname(windsurfConfigPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(windsurfConfigPath, JSON.stringify(config, null, 2));
      console.log('  + Configured: ~/.codeium/windsurf/mcp_config.json (hermit-graph → SQLite brain.db)');
      installed++;
    }
  } catch {
    console.log('  ! Warning: Could not auto-configure Windsurf MCP config');
    console.log(`  Add manually to: ${windsurfConfigPath}`);
    printMcpConfig();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CLINE — auto-write cline_mcp_settings.json
// ══════════════════════════════════════════════════════════════════════════

function configureClineGlobalMcp() {
  if (!userHome) return;

  const settingsPath = getClineMcpSettingsPath();
  try {
    let config = {};
    if (existsSync(settingsPath)) {
      try { config = JSON.parse(readFileSync(settingsPath, 'utf-8')); } catch { /* start fresh */ }
    }

    if (!config.mcpServers) config.mcpServers = {};
    if (!config.mcpServers['hermit-graph']) {
      delete config.mcpServers.memory;
      config.mcpServers['hermit-graph'] = MCP_SERVER_CONFIG;
      const dir = dirname(settingsPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(settingsPath, JSON.stringify(config, null, 2));
      console.log(`  + Configured: ${settingsPath.replace(userHome, '~').replace(/\\/g, '/')}`);
      installed++;
    } else {
      skipped++;
    }
  } catch {
    console.log('  ! Warning: Could not auto-configure Cline MCP settings');
    console.log(`    Manually add hermit-graph to: ${settingsPath}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CODEX — auto-write ~/.codex/config.toml
// ══════════════════════════════════════════════════════════════════════════

function configureCodexGlobalMcp() {
  if (!userHome) return;

  const configPath = join(userHome, '.codex', 'config.toml');
  try {
    let content = '';
    if (existsSync(configPath)) {
      content = readFileSync(configPath, 'utf-8');
    }

    if (!content.includes('[mcp_servers.hermit-graph]')) {
      // Remove legacy [mcp_servers.memory] if present
      content = content.replace(/\[mcp_servers\.memory\][\s\S]*?(?=\[|$)/, '');

      const tomlBlock = [
        '',
        '[mcp_servers.hermit-graph]',
        `command = "node"`,
        `args = ["${hermitServerPath}"]`,
        '',
        '[mcp_servers.hermit-graph.env]',
        `HERMIT_DATA_DIR = ${JSON.stringify(brainDataDir)}`,
        `HF_HUB_DISABLE_SYMLINKS_WARNING = "1"`,
        '',
      ].join('\n');

      content = content.trimEnd() + '\n' + tomlBlock;
      const dir = dirname(configPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(configPath, content);
      console.log(`  + Configured: ~/.codex/config.toml (hermit-graph MCP)`);
      installed++;
    } else {
      skipped++;
    }
  } catch {
    console.log('  ! Warning: Could not auto-configure Codex config.toml');
    console.log(`    Manually add [mcp_servers.hermit-graph] to: ${configPath}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// OPENCODE — JSON config at ~/.opencode/config.json + project opencode.json
// ══════════════════════════════════════════════════════════════════════════

function configureOpenCodeGlobalMcp() {
  if (!userHome) return;

  const configPath = join(userHome, '.opencode', 'config.json');
  try {
    let config = {};
    if (existsSync(configPath)) {
      try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { /* corrupt — start fresh */ }
    }

    if (!config.mcpServers) config.mcpServers = {};
    if (!config.mcpServers['hermit-graph']) {
      delete config.mcpServers.memory; // remove legacy
      config.mcpServers['hermit-graph'] = MCP_SERVER_CONFIG;
      const dir = dirname(configPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`  + Configured: ~/.opencode/config.json (hermit-graph MCP)`);
      installed++;
    } else {
      skipped++;
    }
  } catch {
    console.log('  ! Warning: Could not auto-configure OpenCode config.json');
    console.log(`    Manually add hermit-graph to: ${configPath}`);
  }
}

function configureOpenCodeProjectMcp() {
  const configPath = join(projectRoot, 'opencode.json');
  try {
    let config = {};
    if (existsSync(configPath)) {
      try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { /* corrupt */ }
    }

    if (!config.mcpServers) config.mcpServers = {};
    if (!config.mcpServers['hermit-graph']) {
      config.mcpServers['hermit-graph'] = MCP_SERVER_CONFIG;
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`  + Configured: opencode.json (hermit-graph MCP)`);
      installed++;
    } else {
      skipped++;
    }
  } catch {
    console.log('  ! Warning: Could not auto-configure opencode.json');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// EXPORT HOOKS & COMMANDS FOR NON-CLAUDE AGENTS
// ══════════════════════════════════════════════════════════════════════════

function exportHooksAndCommandsFor(agentName) {
  // Export hooks (kg-auto-recall, kg-auto-update, session-hook, etc.)
  try {
    const results = exportAllHooks(agentName, { global: true });
    for (const r of results) {
      if (r.action === 'error') {
        console.log(`  ! Hook error: ${r.name} — ${r.reason}`);
      } else {
        console.log(`  ${r.action === 'created' ? '+' : '~'} Hook: ${r.name}`);
        installed++;
      }
    }
  } catch (e) {
    console.log(`  ! Could not export hooks for ${agentName}: ${e.message}`);
  }

  // Export commands (/remember, /recall, /impact, etc.)
  try {
    const results = exportAllCommands(agentName, { global: true });
    for (const r of results) {
      if (r.action === 'error') {
        console.log(`  ! Command error: ${r.name} — ${r.reason}`);
      } else {
        console.log(`  ${r.action === 'created' ? '+' : '~'} Command: ${r.name}`);
        installed++;
      }
    }
  } catch (e) {
    console.log(`  ! Could not export commands for ${agentName}: ${e.message}`);
  }
}
