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
 *   hermit setup --mcp-only                   # MCP config only (any agent)
 *   hermit setup --list                       # List available skills
 *   hermit setup --only biz-guard,api-design  # Install only selected skills (Claude)
 *   hermit setup --skip db-migrations         # Install all except skipped (Claude)
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveBrainPath, getPackageRoot, getInstallMode } from './lib/resolve-brain-path.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const brainRoot = getPackageRoot();
const projectRoot = process.cwd();
const args = process.argv.slice(2);
const userHome = process.env.USERPROFILE || process.env.HOME || '';

// brain.jsonl absolute path (resolved for git-clone or npm-install mode)
const brainJsonlPath = resolveBrainPath();

// MCP server config (shared across all agents)
const MCP_SERVER_CONFIG = {
  command: 'npx',
  args: ['-y', '@sockeye44/better-memory-mcp'],
  env: {
    MEMORY_FILE_PATH: brainJsonlPath,
    HF_HUB_DISABLE_SYMLINKS_WARNING: '1'
  }
};

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
    configureGlobalMcp: configureCursorGlobalMcp,
    configureProjectMcp: configureCursorProjectMcp,
    nextSteps: [
      '1. Edit BUSINESS.md with your project business rules',
      '2. Restart Cursor — it now has memory via MCP!',
      '3. Ask: "Do you have memory tools? Try search_nodes with keyword test."',
    ],
    commandsHelp: [
      'MCP tools: search_nodes, create_entities, open_nodes, create_relations',
      'Ask agent: "Remember that..." → it saves to knowledge graph',
      'Ask agent: "What do you know about..." → it searches memory',
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
    configureGlobalMcp: configureWindsurfGlobalMcp,
    configureProjectMcp: () => {},
    nextSteps: [
      '1. Edit BUSINESS.md with your project business rules',
      '2. Restart Windsurf — it now has memory via MCP!',
      '3. Ask: "Do you have memory tools? Try search_nodes with keyword test."',
    ],
    commandsHelp: [
      'MCP tools: search_nodes, create_entities, open_nodes, create_relations',
      'Ask agent: "Remember that..." → it saves to knowledge graph',
    ],
  },
  cline: {
    name: 'Cline (VS Code)',
    configDir: null,
    globalConfigPath: () => null,
    projectConfigPath: () => null,
    supportsSkills: false,
    supportsCommands: false,
    supportsHooks: false,
    configureGlobalMcp: configureClineInstructions,
    configureProjectMcp: () => {},
    nextSteps: [
      '1. Add MCP config to Cline settings (see instructions above)',
      '2. Edit BUSINESS.md with your project business rules',
      '3. Restart VS Code — Cline now has memory via MCP!',
    ],
    commandsHelp: [
      'MCP tools: search_nodes, create_entities, open_nodes, create_relations',
    ],
  },
  codex: {
    name: 'OpenAI Codex CLI',
    configDir: null,
    globalConfigPath: () => null,
    projectConfigPath: () => null,
    supportsSkills: false,
    supportsCommands: false,
    supportsHooks: false,
    configureGlobalMcp: configureCodexInstructions,
    configureProjectMcp: () => {},
    nextSteps: [
      '1. Add MCP config to codex settings (see instructions above)',
      '2. Edit BUSINESS.md with your project business rules',
      '3. Restart codex — it now has memory via MCP!',
    ],
    commandsHelp: [
      'MCP tools: search_nodes, create_entities, open_nodes, create_relations',
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
    if (AGENTS[name]) return name;
    console.log(`Warning: unknown agent "${name}". Supported: ${Object.keys(AGENTS).join(', ')}`);
    console.log('Falling back to Claude Code.\n');
    return 'claude';
  }

  // --mcp-only flag = generic MCP setup
  if (args.includes('--mcp-only')) return 'mcp-only';

  // Auto-detect from project files
  if (existsSync(join(projectRoot, '.cursor'))) return 'cursor';
  if (existsSync(join(projectRoot, '.claude'))) return 'claude';

  // Default to Claude
  return 'claude';
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
  console.log('  --agent <name>         Target agent (claude, cursor, windsurf, cline, codex)');
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
  // ── MCP-only mode: just configure MCP + brain.jsonl ──
  console.log('Hermit Graph — MCP-Only Setup');
  console.log(`Project: ${projectRoot}`);
  console.log(`Brain:   ${brainJsonlPath}`);
  console.log('');

  ensureBrainJsonl();
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

// ── Agent-specific setup ──

console.log(`Hermit Graph — ${agent.name} Setup`);
console.log(`Project: ${projectRoot}`);
console.log(`Brain:   ${brainJsonlPath}`);
if (agent.supportsSkills) {
  // Determine skill selection (Claude only)
  var selectedSkills = [...allSkills];

  const onlyIdx = args.indexOf('--only');
  if (onlyIdx !== -1 && args[onlyIdx + 1]) {
    const only = args[onlyIdx + 1].split(',');
    selectedSkills = only.filter(s => allSkills.includes(s));
    const invalid = only.filter(s => !allSkills.includes(s));
    if (invalid.length) console.log(`Warning: skills not found: ${invalid.join(', ')}`);
  }

  const skipIdx = args.indexOf('--skip');
  if (skipIdx !== -1 && args[skipIdx + 1]) {
    const skip = args[skipIdx + 1].split(',');
    selectedSkills = selectedSkills.filter(s => !skip.includes(s));
  }

  console.log(`Skills:  ${selectedSkills.length}/${allSkills.length} selected`);
}
console.log('');

// ── 1. Ensure brain.jsonl ──
ensureBrainJsonl();

// ── 2. Configure MCP (global + project) ──
agent.configureGlobalMcp();
agent.configureProjectMcp();

// ── 3. Copy skills/commands/hooks (Claude only) ──
if (agent.supportsSkills) {
  installClaudeSkills(selectedSkills);
}
if (agent.supportsCommands) {
  installClaudeCommands();
}
if (agent.supportsHooks) {
  installClaudeHooks();
}

// ── 4. Copy templates ──
copyBusinessTemplate();

// ── 5. CLAUDE.md (Claude only) ──
if (agentKey === 'claude') {
  setupClaudeMd();
  setupGlobalClaudeMd();
}

// ── Summary ──
console.log('');
console.log(`Done! Installed ${installed} items, ${skipped} already existed.`);
console.log('');
console.log('Next steps:');
for (const step of agent.nextSteps) {
  console.log(`  ${step}`);
}
console.log('');
if (agent.commandsHelp.length) {
  console.log(agent.supportsCommands ? 'Key commands:' : 'Key MCP tools:');
  for (const cmd of agent.commandsHelp) {
    console.log(`  ${cmd}`);
  }
  console.log('');
}
if (agent.supportsSkills) {
  console.log(`Skills: ${selectedSkills.length}/${allSkills.length}`);
  console.log('');
  console.log('Manage skills individually:');
  console.log('  hermit skills              — List all available skills');
  console.log('  hermit skills add <name>   — Install a specific skill');
  console.log('  hermit skills remove <name> — Remove a skill');
}

// ══════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ══════════════════════════════════════════════════════════════════════════

function ensureBrainJsonl() {
  if (!existsSync(brainJsonlPath)) {
    const dataDir = dirname(brainJsonlPath);
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    writeFileSync(brainJsonlPath, '');
    console.log('  + Created: data/brain.jsonl (empty knowledge graph)');
  }
}

function copyBusinessTemplate() {
  const templates = [
    { from: 'templates/BUSINESS.md', to: 'BUSINESS.md', note: 'Edit with your project business rules' },
  ];
  // Only copy test template for Claude (other agents don't have slash commands)
  if (agent?.supportsCommands) {
    templates.push({
      from: 'templates/tests/business-rules.test.template.ts',
      to: 'tests/business-rules/rules.test.ts',
      note: 'Edit test assertions for your rules',
    });
  }

  for (const { from, to, note } of templates) {
    const src = join(brainRoot, from);
    const dst = join(projectRoot, to);
    if (existsSync(src) && !existsSync(dst)) {
      const dstDir = dirname(dst);
      if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
      copyFileSync(src, dst);
      console.log(`  + Template: ${to} — ${note}`);
      installed++;
    } else if (existsSync(dst)) {
      skipped++;
    }
  }
}

function printMcpConfig() {
  console.log('Add this to your AI agent MCP settings:\n');
  console.log(JSON.stringify({ mcpServers: { memory: MCP_SERVER_CONFIG } }, null, 2));
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
      globalSettings = JSON.parse(readFileSync(globalSettingsPath, 'utf-8'));
    }

    // Add MCP memory server if not configured
    if (!globalSettings.mcpServers) globalSettings.mcpServers = {};
    const memoryServer = globalSettings.mcpServers.memory;
    const needsMemoryConfig = !memoryServer
      || !memoryServer.env?.MEMORY_FILE_PATH
      || memoryServer.env.MEMORY_FILE_PATH.includes('__BRAIN_JSONL_PATH__');

    if (needsMemoryConfig) {
      globalSettings.mcpServers.memory = MCP_SERVER_CONFIG;
      const globalDir = dirname(globalSettingsPath);
      if (!existsSync(globalDir)) mkdirSync(globalDir, { recursive: true });
      writeFileSync(globalSettingsPath, JSON.stringify(globalSettings, null, 2));
      console.log('  + Configured: ~/.claude/settings.json (MCP memory → brain.jsonl)');
      installed++;
    }

    // Remove dead conventions MCP if present
    if (globalSettings.mcpServers.conventions) {
      delete globalSettings.mcpServers.conventions;
      writeFileSync(globalSettingsPath, JSON.stringify(globalSettings, null, 2));
      console.log('  ~ Cleaned: ~/.claude/settings.json (removed deprecated conventions MCP)');
    }
  } catch {
    console.log('  ! Warning: Could not auto-configure ~/.claude/settings.json');
    console.log(`    Add MCP memory manually with MEMORY_FILE_PATH = ${brainJsonlPath}`);
  }
}

function configureClaudeProject() {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  const claudeDir = join(projectRoot, '.claude');
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  if (!existsSync(settingsPath)) {
    // Create from template with correct brain.jsonl path
    const tmpl = join(brainRoot, '.claude-settings.json');
    if (existsSync(tmpl)) {
      let content = readFileSync(tmpl, 'utf-8');
      content = content.replace('__BRAIN_JSONL_PATH__', brainJsonlPath);
      writeFileSync(settingsPath, content);
      console.log('  + Created: .claude/settings.json (MCP memory + hooks configured)');
      installed++;
    }
  } else {
    // Register kg-auto-recall hook in existing settings.json if not already present
    try {
      const settingsContent = readFileSync(settingsPath, 'utf-8');
      if (!settingsContent.includes('kg-auto-recall')) {
        const settings = JSON.parse(settingsContent);
        if (!settings.hooks) settings.hooks = {};
        if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];

        let hookGroup = settings.hooks.UserPromptSubmit.find(g => g.hooks);
        if (!hookGroup) {
          hookGroup = { hooks: [] };
          settings.hooks.UserPromptSubmit.push(hookGroup);
        }

        hookGroup.hooks.unshift({
          type: 'command',
          command: 'node .claude/hooks/kg-auto-recall.cjs'
        });

        writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log('  ~ Updated: .claude/settings.json (registered kg-auto-recall hook)');
      }
    } catch { /* skip if settings.json can't be parsed */ }
  }
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
      config = JSON.parse(readFileSync(globalMcpPath, 'utf-8'));
    }

    if (!config.mcpServers) config.mcpServers = {};
    if (!config.mcpServers.memory) {
      config.mcpServers.memory = MCP_SERVER_CONFIG;
      const dir = dirname(globalMcpPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(globalMcpPath, JSON.stringify(config, null, 2));
      console.log('  + Configured: ~/.cursor/mcp.json (MCP memory → brain.jsonl)');
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
    const config = { mcpServers: { memory: MCP_SERVER_CONFIG } };
    writeFileSync(projectMcpPath, JSON.stringify(config, null, 2));
    console.log('  + Created: .cursor/mcp.json (project MCP config)');
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
      config = JSON.parse(readFileSync(windsurfConfigPath, 'utf-8'));
    }

    if (!config.mcpServers) config.mcpServers = {};
    if (!config.mcpServers.memory) {
      config.mcpServers.memory = MCP_SERVER_CONFIG;
      const dir = dirname(windsurfConfigPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(windsurfConfigPath, JSON.stringify(config, null, 2));
      console.log('  + Configured: ~/.codeium/windsurf/mcp_config.json (MCP memory → brain.jsonl)');
      installed++;
    }
  } catch {
    console.log('  ! Warning: Could not auto-configure Windsurf MCP config');
    console.log(`  Add manually to: ${windsurfConfigPath}`);
    printMcpConfig();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CLINE — prints instructions (config is in VS Code settings)
// ══════════════════════════════════════════════════════════════════════════

function configureClineInstructions() {
  console.log('  Cline MCP configuration:');
  console.log('');
  console.log('  Option A: Add to VS Code settings.json:');
  console.log('    "cline.mcpServers": {');
  console.log('      "memory": {');
  console.log(`        "command": "npx",`);
  console.log(`        "args": ["-y", "@sockeye44/better-memory-mcp"],`);
  console.log(`        "env": { "MEMORY_FILE_PATH": "${brainJsonlPath}" }`);
  console.log('      }');
  console.log('    }');
  console.log('');
  console.log('  Option B: Use Cline MCP settings UI:');
  console.log('    1. Open Cline sidebar → Settings → MCP Servers');
  console.log('    2. Add server: name=memory, command=npx, args=-y @sockeye44/better-memory-mcp');
  console.log(`    3. Set env: MEMORY_FILE_PATH=${brainJsonlPath}`);
  console.log('');
}

// ══════════════════════════════════════════════════════════════════════════
// CODEX — prints instructions (MCP support varies)
// ══════════════════════════════════════════════════════════════════════════

function configureCodexInstructions() {
  console.log('  OpenAI Codex CLI MCP configuration:');
  console.log('');
  console.log('  Add to ~/.codex/config.json:');
  console.log(JSON.stringify({ mcpServers: { memory: MCP_SERVER_CONFIG } }, null, 2)
    .split('\n').map(l => '    ' + l).join('\n'));
  console.log('');
  console.log('  Or set environment variable:');
  console.log(`    export MEMORY_FILE_PATH="${brainJsonlPath}"`);
  console.log('');
}
