/**
 * skill-export.mjs — Export engine for multi-agent skill distribution.
 *
 * Discovers skills from catalog/, checks agent compatibility,
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
export function discoverSkills() {
  const catalogDir = join(getPackageRoot(), 'catalog', 'skills');
  if (!existsSync(catalogDir)) return [];

  return readdirSync(catalogDir).filter(d => {
    return existsSync(join(catalogDir, d, 'SKILL.md'));
  }).map(name => {
    const content = readFileSync(join(catalogDir, name, 'SKILL.md'), 'utf-8');
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
function writePerFile(targetPath, content) {
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
function resetBackupTracking() { _backedUp = new Set(); }

/** Merge content into a shared file using section markers. Backup before first modify. */
function mergeSingleWrite(targetPath, sectionContent, skillName) {
  const startMarker = `<!-- hermit:skill:${skillName} start -->`;
  const endMarker = `<!-- hermit:skill:${skillName} end -->`;

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

// ── Export orchestration ───────────────────────────────────────────────

/**
 * Export a single skill to a single agent.
 * @param {string} skillName - Skill name from catalog
 * @param {string} agentName - Agent key (claude/cursor/gemini/codex)
 * @param {{ project?: string, global?: boolean }} opts
 * @returns {{ path: string, action: string, agent: string }}
 */
export function exportSkill(skillName, agentName, opts = {}) {
  resetBackupTracking();
  const agentConfig = AGENTS[agentName];
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);

  // Find skill in catalog
  const skills = discoverSkills();
  const skill = skills.find(s => s.name === skillName);
  if (!skill) throw new Error(`Skill not found: ${skillName}`);

  // Compat check
  if (!checkCompat(skill.fm, agentConfig)) {
    return { path: '', action: 'skipped', agent: agentName, name: skillName, reason: 'MCP required' };
  }

  // Resolve target path
  const useGlobal = opts.global || !opts.project;
  const targetPath = useGlobal
    ? agentConfig.globalSkillPath(skillName)
    : agentConfig.skillPath(skillName, opts.project);

  // Transform content
  const meta = { name: skillName, description: skill.fm?.description || skillName };
  const transformed = agentConfig.transform(skill.body || skill.content, meta);

  // Write using appropriate strategy
  const action = agentConfig.strategy === 'merge-single'
    ? mergeSingleWrite(targetPath, transformed, skillName)
    : writePerFile(targetPath, transformed);

  return { path: targetPath.replace(/\\/g, '/'), action, agent: agentName };
}

/**
 * Export all compatible skills to a single agent.
 * @returns {Array<{ path, action, agent }>}
 */
export function exportAll(agentName, opts = {}) {
  resetBackupTracking();
  const skills = discoverSkills();
  const agentConfig = AGENTS[agentName];
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);

  return skills.map(skill => {
    if (!checkCompat(skill.fm, agentConfig)) {
      return { path: '', action: 'skipped', agent: agentName, name: skill.name, reason: 'MCP required' };
    }

    const useGlobal = opts.global || !opts.project;
    const targetPath = useGlobal
      ? agentConfig.globalSkillPath(skill.name)
      : agentConfig.skillPath(skill.name, opts.project);

    const meta = { name: skill.name, description: skill.fm?.description || skill.name };
    const transformed = agentConfig.transform(skill.body || skill.content, meta);

    const action = agentConfig.strategy === 'merge-single'
      ? mergeSingleWrite(targetPath, transformed, skill.name)
      : writePerFile(targetPath, transformed);

    return { path: targetPath.replace(/\\/g, '/'), action, agent: agentName };
  });
}
