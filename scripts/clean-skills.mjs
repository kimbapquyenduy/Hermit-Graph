#!/usr/bin/env node
/**
 * Clean frontmatter (--- blocks) from copied skills
 * so Claude Code reads them cleanly
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(__dirname, '..', '.claude', 'skills');

let cleaned = 0;
for (const skill of readdirSync(skillsDir)) {
  const f = join(skillsDir, skill, 'SKILL.md');
  if (!existsSync(f)) continue;
  let content = readFileSync(f, 'utf-8');
  // Remove YAML frontmatter (--- ... ---)
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  if (match) {
    content = content.slice(match[0].length).trimStart();
    writeFileSync(f, content);
    console.log(`✅ Cleaned: ${skill}`);
    cleaned++;
  }
}
console.log(`\nCleaned ${cleaned} skills.`);
