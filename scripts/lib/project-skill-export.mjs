/**
 * project-skill-export.mjs — Export project skills from .claude/skills/.
 *
 * Discovers skills from any project's .claude/skills/ directory and exports
 * them to other AI agents using the same transform pipeline as hermit catalog.
 *
 * Uses same 'skill' marker prefix as hermit catalog — project skills with
 * matching names naturally override catalog skills (last-write-wins).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { AGENTS, parseFrontmatter } from './skill-adapters.mjs';
import { checkCompat, writePerFile, mergeSingleWrite, resetBackupTracking } from './skill-export.mjs';

// Directories to skip when scanning .claude/skills/
const SKIP_DIRS = new Set(['_shared', '.venv', 'node_modules', '.git']);

// ── Project skill discovery ───────────────────────────────────────────

/**
 * Discover skills from a project's .claude/skills/ directory.
 * @param {string} projectRoot - Project root (defaults to cwd)
 * @returns {Array<{ name, content, fm, body, source: 'project' }>}
 */
export function discoverProjectSkills(projectRoot) {
  const skillsDir = join(projectRoot || process.cwd(), '.claude', 'skills');
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir).filter(d => {
    if (SKIP_DIRS.has(d)) return false;
    const dirPath = join(skillsDir, d);
    if (!statSync(dirPath).isDirectory()) return false;
    return existsSync(join(dirPath, 'SKILL.md'));
  }).map(name => {
    const raw = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf-8');
    const content = raw.replace(/\r\n/g, '\n'); // normalize CRLF → LF for cross-agent compat
    const { fm, body } = parseFrontmatter(content);
    return { name, content, fm, body, source: 'project' };
  });
}

// ── Project skill export ──────────────────────────────────────────────

/**
 * Export a single project skill to a single agent.
 * @param {string} skillName - Skill directory name from .claude/skills/
 * @param {string} agentName - Target agent key
 * @param {{ project?: string, global?: boolean, sourceProject?: string }} opts
 *   - sourceProject: where to discover skills from (defaults to cwd)
 *   - project: target project for per-file writes
 *   - global: write to agent global config dir
 */
export function exportProjectSkill(skillName, agentName, opts = {}) {
  resetBackupTracking();
  const agentConfig = AGENTS[agentName];
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);

  const sourceRoot = opts.sourceProject || process.cwd();
  const skills = discoverProjectSkills(sourceRoot);
  const skill = skills.find(s => s.name === skillName);
  if (!skill) throw new Error(`Project skill not found: ${skillName}`);

  return _exportOneProjectSkill(skill, agentName, agentConfig, opts);
}

/**
 * Export all project skills to a single agent.
 * @returns {Array<{ path, action, agent, name, source }>}
 */
export function exportAllProjectSkills(agentName, opts = {}) {
  resetBackupTracking();
  const agentConfig = AGENTS[agentName];
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);

  const sourceRoot = opts.sourceProject || process.cwd();
  const skills = discoverProjectSkills(sourceRoot);
  if (!skills.length) return [];

  return skills.map(skill => _exportOneProjectSkill(skill, agentName, agentConfig, opts));
}

/**
 * Internal: export a single discovered project skill.
 * Same 'skill' marker prefix — project skills override catalog on name collision.
 */
function _exportOneProjectSkill(skill, agentName, agentConfig, opts) {
  const skillCfg = agentConfig.skills;

  // Compat check
  if (!checkCompat(skill.fm, agentConfig)) {
    return { path: '', action: 'skipped', agent: agentName, name: skill.name, source: 'project', reason: 'MCP required' };
  }

  // Resolve target path — same as catalog skills (project overrides catalog on collision)
  const useGlobal = opts.global || !opts.project;
  const targetPath = useGlobal
    ? skillCfg.globalPath(skill.name)
    : skillCfg.path(skill.name, opts.project);

  // Transform content — use skill body, strip Claude refs via agent pipeline
  const desc = skill.fm?.description || skill.name;
  const meta = { name: skill.name, description: desc };
  const transformed = skillCfg.transform(skill.body || skill.content, meta);

  // Write — same 'skill' marker prefix as catalog (sectionWrap markers must match)
  const action = skillCfg.strategy === 'merge-single'
    ? mergeSingleWrite(targetPath, transformed, skill.name, 'skill')
    : writePerFile(targetPath, transformed);

  return { path: targetPath.replace(/\\/g, '/'), action, agent: agentName, name: skill.name, source: 'project' };
}
