#!/usr/bin/env node
/**
 * Hermit Graph — Skills Manager
 *
 * Install, list, and remove AI agent skills without needing ClaudeKit.
 * Sources from catalog/ directory (tracked in git).
 *
 * Usage:
 *   hermit skills                    List all available skills
 *   hermit skills list               List all available skills
 *   hermit skills add <name...>      Install specific skills
 *   hermit skills add --all          Install all skills + commands + hooks
 *   hermit skills remove <name...>   Remove skills from current project
 *   hermit skills info <name>        Show skill details
 *   hermit skills installed          Show skills installed in current project
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HERMIT_ROOT = resolve(__dirname, '..');
const PROJECT_ROOT = process.cwd();

// Source from catalog/ (git-tracked, hermit-graph's own content)
const CATALOG = join(HERMIT_ROOT, 'catalog');
const SKILLS_SRC = join(CATALOG, 'skills');
const COMMANDS_SRC = join(CATALOG, 'commands');
const HOOKS_SRC = join(CATALOG, 'hooks');

// ── Discover available content ──

function getAvailableSkills() {
  if (!existsSync(SKILLS_SRC)) return [];
  return readdirSync(SKILLS_SRC).filter(d => {
    return existsSync(join(SKILLS_SRC, d, 'SKILL.md'));
  });
}

function getSkillTitle(skillName) {
  const skillFile = join(SKILLS_SRC, skillName, 'SKILL.md');
  if (!existsSync(skillFile)) return skillName;
  const content = readFileSync(skillFile, 'utf-8');

  // Try first markdown heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1];

  return skillName;
}

function getInstalledSkills() {
  const skillsDir = join(PROJECT_ROOT, '.claude', 'skills');
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir).filter(d => {
    return existsSync(join(skillsDir, d, 'SKILL.md'));
  });
}

function getAvailableCommands() {
  if (!existsSync(COMMANDS_SRC)) return [];
  return readdirSync(COMMANDS_SRC).filter(f => f.endsWith('.md'));
}

function getInstalledCommands() {
  const cmdDir = join(PROJECT_ROOT, '.claude', 'commands');
  if (!existsSync(cmdDir)) return [];
  return readdirSync(cmdDir).filter(f => f.endsWith('.md'));
}

function getAvailableHooks() {
  if (!existsSync(HOOKS_SRC)) return [];
  return readdirSync(HOOKS_SRC).filter(f => statSync(join(HOOKS_SRC, f)).isFile());
}

// ── Actions ──

function listSkills() {
  const skills = getAvailableSkills();
  const installed = new Set(getInstalledSkills());
  const commands = getAvailableCommands();
  const installedCmds = new Set(getInstalledCommands());
  const hooks = getAvailableHooks();

  console.log(`\n  Hermit Graph — Catalog (${skills.length} skills, ${commands.length} commands, ${hooks.length} hooks)\n`);

  // Skills
  if (skills.length > 0) {
    console.log('  Skills:');
    for (const name of skills) {
      const mark = installed.has(name) ? '[x]' : '[ ]';
      const title = getSkillTitle(name);
      console.log(`    ${mark} ${name.padEnd(20)} ${title}`);
    }
    console.log('');
  }

  // Commands
  if (commands.length > 0) {
    console.log('  Slash Commands:');
    for (const cmd of commands) {
      const name = cmd.replace('.md', '');
      const mark = installedCmds.has(cmd) ? '[x]' : '[ ]';
      console.log(`    ${mark} /${name}`);
    }
    console.log('');
  }

  // Hooks
  if (hooks.length > 0) {
    console.log('  Hooks:');
    for (const hook of hooks) {
      console.log(`    ${hook}`);
    }
    console.log('');
  }

  console.log('  [x] = installed in current project\n');
  console.log('  Usage:');
  console.log('    hermit skills add <name>       Install a skill');
  console.log('    hermit skills add --all        Install all skills + commands + hooks');
  console.log('    hermit skills info <name>      Skill details');
  console.log('    hermit skills remove <name>    Remove a skill');
  console.log('');
}

function addSkills(names, { includeCommands = false, includeHooks = false } = {}) {
  const available = getAvailableSkills();
  const all = names.includes('--all');
  const toInstall = all ? available : names;

  // Validate
  if (!all) {
    const invalid = toInstall.filter(n => !available.includes(n));
    if (invalid.length) {
      console.error(`Skills not found: ${invalid.join(', ')}`);
      console.error(`Run 'hermit skills list' to see available skills.`);
      process.exit(1);
    }
  }

  let installed = 0;
  let skipped = 0;

  // Ensure directories
  const skillsDst = join(PROJECT_ROOT, '.claude', 'skills');
  if (!existsSync(skillsDst)) mkdirSync(skillsDst, { recursive: true });

  // Copy skills
  for (const name of toInstall) {
    const srcDir = join(SKILLS_SRC, name);
    const dstDir = join(skillsDst, name);

    if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

    // Copy all files in the skill directory
    const files = readdirSync(srcDir);
    let skillInstalled = false;
    for (const file of files) {
      const srcFile = join(srcDir, file);
      const dstFile = join(dstDir, file);
      if (statSync(srcFile).isFile() && !existsSync(dstFile)) {
        copyFileSync(srcFile, dstFile);
        skillInstalled = true;
      }
    }

    if (skillInstalled) {
      console.log(`  + ${name}`);
      installed++;
    } else {
      skipped++;
    }
  }

  // Copy commands (when --all or --commands)
  if (includeCommands || all) {
    const cmdsDst = join(PROJECT_ROOT, '.claude', 'commands');
    if (!existsSync(cmdsDst)) mkdirSync(cmdsDst, { recursive: true });
    for (const cmd of getAvailableCommands()) {
      const src = join(COMMANDS_SRC, cmd);
      const dst = join(cmdsDst, cmd);
      if (!existsSync(dst)) {
        copyFileSync(src, dst);
        console.log(`  + /${cmd.replace('.md', '')}`);
        installed++;
      } else {
        skipped++;
      }
    }
  }

  // Copy hooks (when --all or --hooks)
  if (includeHooks || all) {
    const hooksDst = join(PROJECT_ROOT, '.claude', 'hooks');
    if (!existsSync(hooksDst)) mkdirSync(hooksDst, { recursive: true });
    for (const hook of getAvailableHooks()) {
      const src = join(HOOKS_SRC, hook);
      const dst = join(hooksDst, hook);
      if (!existsSync(dst)) {
        copyFileSync(src, dst);
        console.log(`  + hook: ${hook}`);
        installed++;
      } else {
        skipped++;
      }
    }
  }

  console.log(`\n  Done! ${installed} installed, ${skipped} already existed.`);
}

function removeSkills(names) {
  let removed = 0;
  for (const name of names) {
    const skillDir = join(PROJECT_ROOT, '.claude', 'skills', name);
    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true });
      console.log(`  - ${name}`);
      removed++;
    } else {
      console.log(`  ? ${name} (not installed)`);
    }
  }
  console.log(`\n  Removed ${removed} skill(s).`);
}

function showInfo(name) {
  const skillFile = join(SKILLS_SRC, name, 'SKILL.md');
  if (!existsSync(skillFile)) {
    console.error(`Skill not found: ${name}`);
    console.error(`Run 'hermit skills list' to see available skills.`);
    process.exit(1);
  }
  const content = readFileSync(skillFile, 'utf-8');

  // Show first 40 lines or until second ## heading
  const lines = content.split('\n');
  const previewLines = [];
  let headingCount = 0;
  for (const line of lines) {
    if (line.startsWith('## ') && headingCount > 0 && previewLines.length > 10) break;
    if (line.startsWith('## ')) headingCount++;
    previewLines.push(line);
    if (previewLines.length >= 40) break;
  }

  console.log(`\n${previewLines.join('\n')}`);
  if (previewLines.length < lines.length) {
    console.log(`\n  ... (${lines.length - previewLines.length} more lines)`);
    console.log(`  Full path: ${skillFile}`);
  }
  console.log('');
}

function showInstalled() {
  const skills = getInstalledSkills();
  const commands = getInstalledCommands();

  if (skills.length === 0 && commands.length === 0) {
    console.log('\n  No Hermit Graph skills installed in this project.');
    console.log('  Run: hermit skills add --all\n');
    return;
  }

  console.log(`\n  Installed in: ${PROJECT_ROOT}\n`);

  if (skills.length > 0) {
    console.log(`  Skills (${skills.length}):`);
    for (const s of skills) console.log(`    ${s}`);
  }

  if (commands.length > 0) {
    console.log(`\n  Commands (${commands.length}):`);
    for (const c of commands) console.log(`    /${c.replace('.md', '')}`);
  }

  console.log('');
}

// ── Main ──

export async function run(args) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === 'list') {
    listSkills();
  } else if (subcommand === 'add') {
    if (rest.length === 0) {
      console.error('Usage: hermit skills add <name...> or hermit skills add --all');
      process.exit(1);
    }
    const includeCommands = rest.includes('--commands') || rest.includes('--all');
    const includeHooks = rest.includes('--hooks') || rest.includes('--all');
    const names = rest.filter(n => !n.startsWith('--'));
    addSkills(rest.includes('--all') ? ['--all'] : names, { includeCommands, includeHooks });
  } else if (subcommand === 'remove' || subcommand === 'rm') {
    if (rest.length === 0) {
      console.error('Usage: hermit skills remove <name...>');
      process.exit(1);
    }
    removeSkills(rest);
  } else if (subcommand === 'info') {
    if (!rest[0]) {
      console.error('Usage: hermit skills info <name>');
      process.exit(1);
    }
    showInfo(rest[0]);
  } else if (subcommand === 'installed') {
    showInstalled();
  } else if (subcommand === 'export') {
    const { exportSkill, exportAll } = await import('./lib/skill-export.mjs');
    const { AGENTS } = await import('./lib/skill-adapters.mjs');
    const agentNames = Object.keys(AGENTS);

    // Parse flags
    const agentIdx = rest.indexOf('--agent');
    const agent = agentIdx !== -1 ? rest[agentIdx + 1] : null;
    const projectIdx = rest.indexOf('--project');
    const project = projectIdx !== -1 ? rest[projectIdx + 1] : null;
    const isGlobal = rest.includes('--global') || !project;
    const isAll = rest.includes('--all');
    const skillName = rest.find(a => !a.startsWith('--') && a !== agent && a !== project);

    if (project && (!existsSync(project) || !statSync(project).isDirectory())) {
      console.error(`Project path not found or not a directory: ${project}`);
      process.exit(1);
    }

    if (!agent || (agent !== 'all' && !agentNames.includes(agent))) {
      console.error(`Invalid agent. Use: ${agentNames.join(', ')}, all`);
      process.exit(1);
    }
    if (!isAll && !skillName) {
      console.error('Usage: hermit skills export <name|--all> --agent <agent> [--project /path] [--global]');
      process.exit(1);
    }

    const agents = agent === 'all' ? agentNames : [agent];
    const opts = { project, global: isGlobal };
    const results = [];

    for (const ag of agents) {
      if (isAll) {
        results.push(...exportAll(ag, opts));
      } else {
        results.push(exportSkill(skillName, ag, opts));
      }
    }

    for (const r of results) {
      const icon = r.action === 'created' ? '+' : r.action === 'updated' ? '~' : '-';
      const skipLabel = r.name ? `${r.name} skipped (${r.reason})` : `skipped (${r.reason})`;
      const detail = r.action === 'skipped' ? skipLabel : `${r.path} (${r.action})`;
      console.log(`  ${icon} [${r.agent}] ${detail}`);
    }
    console.log(`\n  Done! ${results.filter(r => r.action !== 'skipped').length} exported.`);
  } else {
    const available = getAvailableSkills();
    if (available.includes(subcommand)) {
      console.log(`Did you mean: hermit skills add ${subcommand}?`);
    } else {
      console.error(`Unknown subcommand: ${subcommand}`);
      console.log('\nUsage:');
      console.log('  hermit skills              List available skills');
      console.log('  hermit skills add <name>   Install skill(s)');
      console.log('  hermit skills add --all    Install everything');
      console.log('  hermit skills remove <n>   Remove skill(s)');
      console.log('  hermit skills info <name>  Show skill details');
      console.log('  hermit skills installed    Show installed skills');
      console.log('  hermit skills export       Export skill(s) to other AI agents');
    }
    process.exit(1);
  }
}

// Direct execution
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run(process.argv.slice(2)).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
