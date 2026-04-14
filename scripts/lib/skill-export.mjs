/**
 * skill-export.mjs — Export engine for multi-agent skill + command distribution.
 *
 * Discovers skills/commands from catalog/, checks agent compatibility,
 * transforms content via adapters, and writes to target locations.
 *
 * Write strategies: per-file (Claude/Cursor), merge-single (Gemini/Codex)
 * Merge-single uses section markers for idempotent replace + .hermit/backups/.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { AGENTS, parseFrontmatter } from './skill-adapters.mjs';
import { getPackageRoot } from './resolve-brain-path.mjs';

// ── Skill discovery ────────────────────────────────────────────────────

/** Discover all skills from catalog/skills/. Returns [{ name, content, fm, body }]. */
export function discoverSkills(catalogRoot) {
  const catalogDir = join(catalogRoot || getPackageRoot(), 'catalog', 'skills');
  if (!existsSync(catalogDir)) return [];

  return readdirSync(catalogDir).filter(d => {
    return existsSync(join(catalogDir, d, 'SKILL.md'));
  }).map(name => {
    const content = readFileSync(join(catalogDir, name, 'SKILL.md'), 'utf-8');
    const { fm, body } = parseFrontmatter(content);
    return { name, content, fm, body };
  });
}

// ── Command discovery ──────────────────────────────────────────────────

/** Discover all commands from catalog/commands/. Returns [{ name, content, fm, body }]. */
export function discoverCommands(catalogRoot) {
  const catalogDir = join(catalogRoot || getPackageRoot(), 'catalog', 'commands');
  if (!existsSync(catalogDir)) return [];

  return readdirSync(catalogDir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const name = f.replace('.md', '');
      const content = readFileSync(join(catalogDir, f), 'utf-8');
      const { fm, body } = parseFrontmatter(content);
      return { name, content, fm, body };
    });
}

// ── Compatibility check ────────────────────────────────────────────────

/** Check if skill is compatible with agent. MCP-only skills skip non-MCP agents. */
export function checkCompat(fm, agentConfig) {
  // Check key existence (not truthiness) — parseFrontmatter may yield empty string for `allowed-tools:`
  if (fm && 'allowed-tools' in fm && !agentConfig.mcpCapable) return false;
  return true;
}

// ── Write strategies ───────────────────────────────────────────────────

/** Write a single file (mkdir + overwrite). Returns 'created' | 'updated'. */
export function writePerFile(targetPath, content) {
  const existed = existsSync(targetPath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, 'utf-8');
  return existed ? 'updated' : 'created';
}

/** Backup a file to .hermit/backups/ once per export batch (not per-write). */
let _backedUp = new Set();
function backupOnce(targetPath) {
  if (_backedUp.has(targetPath) || !existsSync(targetPath)) return;
  const backupDir = join(dirname(targetPath), '.hermit', 'backups');
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(join(backupDir, basename(targetPath) + '.bak'), readFileSync(targetPath, 'utf-8'), 'utf-8');
  _backedUp.add(targetPath);
}
export function resetBackupTracking() { _backedUp = new Set(); }

/**
 * Merge content into a shared file using section markers. Backup before first modify.
 * @param {string} markerPrefix - 'skill' or 'cmd' for distinct marker namespaces
 */
export function mergeSingleWrite(targetPath, sectionContent, itemName, markerPrefix = 'skill') {
  const startMarker = `<!-- hermit:${markerPrefix}:${itemName} start -->`;
  const endMarker = `<!-- hermit:${markerPrefix}:${itemName} end -->`;

  let existing = '';
  let existed = false;
  if (existsSync(targetPath)) {
    existing = readFileSync(targetPath, 'utf-8');
    existed = true;
    backupOnce(targetPath);
  }

  const startIdx = existing.indexOf(startMarker);
  const endIdx = existing.indexOf(endMarker);
  let result;

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + endMarker.length);
    result = before + sectionContent + after;
  } else {
    // Append new section
    const sep = existing.length > 0 ? '\n\n' : '';
    result = existing + sep + sectionContent;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, result, 'utf-8');
  return existed ? 'updated' : 'created';
}

// ── Skill export ─────────────────────────────────────────────────────

/**
 * Export a single skill to a single agent.
 * @param {string} skillName - Skill name from catalog
 * @param {string} agentName - Agent key (claude/cursor/gemini/codex)
 * @param {{ project?: string, global?: boolean }} opts
 * @param {string} [catalogRoot] - Override catalog root (for testing)
 * @returns {{ path: string, action: string, agent: string }}
 */
export function exportSkill(skillName, agentName, opts = {}, catalogRoot) {
  resetBackupTracking();
  const agentConfig = AGENTS[agentName];
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);

  // TODO(v4.4): Cache discoverSkills() result across calls in same export batch.
  // Currently re-reads catalog for each single-skill export. Acceptable for <20 skills.
  const skills = discoverSkills(catalogRoot);
  const skill = skills.find(s => s.name === skillName);
  if (!skill) throw new Error(`Skill not found: ${skillName}`);

  const skillCfg = agentConfig.skills;

  // Compat check
  if (!checkCompat(skill.fm, agentConfig)) {
    return { path: '', action: 'skipped', agent: agentName, name: skillName, reason: 'MCP required' };
  }

  // Resolve target path
  const useGlobal = opts.global || !opts.project;
  const targetPath = useGlobal
    ? skillCfg.globalPath(skillName)
    : skillCfg.path(skillName, opts.project);

  // Transform content — Claude gets full content (preserves frontmatter for paths: activation),
  // non-Claude agents get body only (frontmatter already stripped by parseFrontmatter)
  const meta = { name: skillName, description: skill.fm?.description || skillName };
  const source = agentName === 'claude' ? (skill.content || skill.body) : (skill.body || skill.content);
  const transformed = skillCfg.transform(source, meta);

  // Write using appropriate strategy
  const action = skillCfg.strategy === 'merge-single'
    ? mergeSingleWrite(targetPath, transformed, skillName, 'skill')
    : writePerFile(targetPath, transformed);

  return { path: targetPath.replace(/\\/g, '/'), action, agent: agentName };
}

/**
 * Export all compatible skills to a single agent.
 * @returns {Array<{ path, action, agent }>}
 */
export function exportAll(agentName, opts = {}, catalogRoot) {
  resetBackupTracking();
  const skills = discoverSkills(catalogRoot);
  const agentConfig = AGENTS[agentName];
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);

  const skillCfg = agentConfig.skills;

  return skills.map(skill => {
    if (!checkCompat(skill.fm, agentConfig)) {
      return { path: '', action: 'skipped', agent: agentName, name: skill.name, reason: 'MCP required' };
    }

    const useGlobal = opts.global || !opts.project;
    const targetPath = useGlobal
      ? skillCfg.globalPath(skill.name)
      : skillCfg.path(skill.name, opts.project);

    const meta = { name: skill.name, description: skill.fm?.description || skill.name };
    const source = agentName === 'claude' ? (skill.content || skill.body) : (skill.body || skill.content);
    const transformed = skillCfg.transform(source, meta);

    const action = skillCfg.strategy === 'merge-single'
      ? mergeSingleWrite(targetPath, transformed, skill.name, 'skill')
      : writePerFile(targetPath, transformed);

    return { path: targetPath.replace(/\\/g, '/'), action, agent: agentName };
  });
}

// ── Command export ───────────────────────────────────────────────────

/**
 * Export a single command to a single agent.
 * @param {string} cmdName - Command name from catalog
 * @param {string} agentName - Agent key (claude/cursor/gemini/codex)
 * @param {{ project?: string, global?: boolean }} opts
 * @param {string} [catalogRoot] - Override catalog root (for testing)
 */
export function exportCommand(cmdName, agentName, opts = {}, catalogRoot) {
  resetBackupTracking();
  const agentConfig = AGENTS[agentName];
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);

  const commands = discoverCommands(catalogRoot);
  const cmd = commands.find(c => c.name === cmdName);
  if (!cmd) throw new Error(`Command not found: ${cmdName}`);

  const cmdCfg = agentConfig.commands;

  // Resolve target path
  const useGlobal = opts.global || !opts.project;
  const targetPath = useGlobal
    ? cmdCfg.globalPath(cmdName)
    : cmdCfg.path(cmdName, opts.project);

  // Transform content
  const meta = { name: cmdName, description: cmd.fm?.description || cmdName };
  const transformed = cmdCfg.transform(cmd.body || cmd.content, meta);

  // Write using appropriate strategy — commands use 'cmd' marker prefix
  const action = cmdCfg.strategy === 'merge-single'
    ? mergeSingleWrite(targetPath, transformed, cmdName, 'cmd')
    : writePerFile(targetPath, transformed);

  return { path: targetPath.replace(/\\/g, '/'), action, agent: agentName, name: cmdName };
}

/**
 * Export all commands to a single agent.
 * @returns {Array<{ path, action, agent, name }>}
 */
export function exportAllCommands(agentName, opts = {}, catalogRoot) {
  resetBackupTracking();
  const commands = discoverCommands(catalogRoot);
  const agentConfig = AGENTS[agentName];
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);

  const cmdCfg = agentConfig.commands;

  return commands.map(cmd => {
    const useGlobal = opts.global || !opts.project;
    const targetPath = useGlobal
      ? cmdCfg.globalPath(cmd.name)
      : cmdCfg.path(cmd.name, opts.project);

    const meta = { name: cmd.name, description: cmd.fm?.description || cmd.name };
    const transformed = cmdCfg.transform(cmd.body || cmd.content, meta);

    const action = cmdCfg.strategy === 'merge-single'
      ? mergeSingleWrite(targetPath, transformed, cmd.name, 'cmd')
      : writePerFile(targetPath, transformed);

    return { path: targetPath.replace(/\\/g, '/'), action, agent: agentName, name: cmd.name };
  });
}
