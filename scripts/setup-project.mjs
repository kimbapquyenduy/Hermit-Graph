#!/usr/bin/env node

/**
 * Setup Claude Code Brain cho project mới
 * 
 * Usage:
 *   node path/to/claude-code-brain/scripts/setup-project.mjs              ← Setup all skills
 *   node path/to/claude-code-brain/scripts/setup-project.mjs --list       ← List available skills
 *   node path/to/claude-code-brain/scripts/setup-project.mjs --only biz-guard,api-design  ← Chọn skill
 *   node path/to/claude-code-brain/scripts/setup-project.mjs --skip db-migrations         ← Bỏ skill
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const brainRoot = join(__dirname, '..');
const projectRoot = process.cwd();
const args = process.argv.slice(2);

// Available skills
const skillsDir = join(brainRoot, '.claude', 'skills');
const allSkills = readdirSync(skillsDir).filter(d => {
  return existsSync(join(skillsDir, d, 'SKILL.md'));
});

// --list: show skills and exit
if (args.includes('--list')) {
  console.log('📚 Available skills in Claude Code Brain:\n');
  for (const skill of allSkills) {
    const content = readFileSync(join(skillsDir, skill, 'SKILL.md'), 'utf-8');
    const title = content.split('\n').find(l => l.startsWith('# '))?.replace('# ', '') || skill;
    console.log(`  • ${skill.padEnd(20)} — ${title}`);
  }
  console.log(`\nTotal: ${allSkills.length} skills`);
  console.log('\nUsage:');
  console.log('  --only skill1,skill2   Install chỉ các skill được chọn');
  console.log('  --skip skill1,skill2   Install tất cả trừ các skill bỏ qua');
  process.exit(0);
}

// Determine which skills to install
let selectedSkills = [...allSkills];

const onlyIdx = args.indexOf('--only');
if (onlyIdx !== -1 && args[onlyIdx + 1]) {
  const only = args[onlyIdx + 1].split(',');
  selectedSkills = only.filter(s => allSkills.includes(s));
  const invalid = only.filter(s => !allSkills.includes(s));
  if (invalid.length) console.log(`⚠️  Skill không tồn tại: ${invalid.join(', ')}`);
}

const skipIdx = args.indexOf('--skip');
if (skipIdx !== -1 && args[skipIdx + 1]) {
  const skip = args[skipIdx + 1].split(',');
  selectedSkills = selectedSkills.filter(s => !skip.includes(s));
}

console.log('🧠 Claude Code Brain — Setup Project');
console.log(`📁 Project: ${projectRoot}`);
console.log(`📚 Skills: ${selectedSkills.join(', ') || '(none)'}`);
console.log('');

// Create directories
const dirs = ['.claude/commands', '.claude/hooks'];
for (const skill of selectedSkills) {
  dirs.push(`.claude/skills/${skill}`);
}

for (const dir of dirs) {
  const fullPath = join(projectRoot, dir);
  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
  }
}

// Copy skills
for (const skill of selectedSkills) {
  const src = join(skillsDir, skill, 'SKILL.md');
  const dst = join(projectRoot, '.claude', 'skills', skill, 'SKILL.md');
  if (!existsSync(dst)) {
    copyFileSync(src, dst);
    console.log(`✅ Skill: ${skill}`);
  } else {
    console.log(`⏭️  Skill exists: ${skill}`);
  }
}

// Copy commands (always)
const commandsDir = join(brainRoot, '.claude', 'commands');
if (existsSync(commandsDir)) {
  for (const cmd of readdirSync(commandsDir)) {
    const src = join(commandsDir, cmd);
    const dst = join(projectRoot, '.claude', 'commands', cmd);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
      console.log(`✅ Command: /${cmd.replace('.md', '')}`);
    } else {
      console.log(`⏭️  Command exists: /${cmd.replace('.md', '')}`);
    }
  }
}

// Copy hooks (always)
const hooksDir = join(brainRoot, '.claude', 'hooks');
if (existsSync(hooksDir)) {
  for (const hook of readdirSync(hooksDir)) {
    const src = join(hooksDir, hook);
    const dst = join(projectRoot, '.claude', 'hooks', hook);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
      console.log(`✅ Hook: ${hook.replace('.md', '')}`);
    } else {
      console.log(`⏭️  Hook exists: ${hook.replace('.md', '')}`);
    }
  }
}

// Copy templates (only if not exists)
const templates = [
  { from: 'templates/BUSINESS.md', to: 'BUSINESS.md', note: 'SỬA CHO ĐÚNG BIZ CỦA PROJECT' },
  { from: 'templates/tests/business-rules.test.template.ts', to: 'tests/business-rules/rules.test.ts', note: 'SỬA CHO ĐÚNG RULES' },
];

for (const { from, to, note } of templates) {
  const src = join(brainRoot, from);
  const dst = join(projectRoot, to);
  if (existsSync(src) && !existsSync(dst)) {
    const dstDir = dirname(dst);
    if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
    copyFileSync(src, dst);
    console.log(`📝 Template: ${to} ← ${note}`);
  } else if (existsSync(dst)) {
    console.log(`⏭️  Template exists: ${to}`);
  }
}

// CLAUDE.md
const claudeMd = join(projectRoot, 'CLAUDE.md');
if (existsSync(claudeMd)) {
  const content = readFileSync(claudeMd, 'utf-8');
  if (!content.includes('BUSINESS.md')) {
    const appendix = `\n\n## ⚠️ BẮT BUỘC ĐỌC TRƯỚC KHI CODE\n- Đọc \`BUSINESS.md\` trước khi sửa bất kỳ business logic nào\n- Chạy \`/impact\` trước khi sửa code ảnh hưởng nhiều module\n- Chạy \`/biz-review\` sau khi sửa xong để verify business rules\n- Chạy \`/biz-init\` nếu project chưa có \`BUSINESS.md\`\n`;
    writeFileSync(claudeMd, content + appendix);
    console.log('📝 Updated: CLAUDE.md (thêm biz guard reference)');
  }
} else {
  const tmpl = join(brainRoot, 'templates/CLAUDE.md');
  if (existsSync(tmpl)) {
    copyFileSync(tmpl, claudeMd);
    console.log('📝 Created: CLAUDE.md ← SỬA CHO ĐÚNG PROJECT');
  }
}

// .claude/settings.json with MCP memory
const settingsPath = join(projectRoot, '.claude', 'settings.json');
if (!existsSync(settingsPath)) {
  const brainSettings = join(brainRoot, '.claude-settings.json');
  if (existsSync(brainSettings)) {
    copyFileSync(brainSettings, settingsPath);
    console.log('🔗 MCP Memory: .claude/settings.json');
    console.log('   ⚠️  Sửa MEMORY_FILE_PATH cho đúng path!');
  }
}

// Global CLAUDE.md (user home ~/.claude/CLAUDE.md)
const userHome = process.env.USERPROFILE || process.env.HOME || '';
const globalClaudeMd = join(userHome, '.claude', 'CLAUDE.md');
if (userHome && !existsSync(globalClaudeMd)) {
  const tmpl = join(brainRoot, 'templates', 'global-CLAUDE.md');
  if (existsSync(tmpl)) {
    const globalDir = dirname(globalClaudeMd);
    if (!existsSync(globalDir)) mkdirSync(globalDir, { recursive: true });
    copyFileSync(tmpl, globalClaudeMd);
    console.log('🧠 Global: ~/.claude/CLAUDE.md (auto-memory instructions)');
  }
} else if (existsSync(globalClaudeMd)) {
  console.log('⏭️  Global ~/.claude/CLAUDE.md exists');
}

console.log('');
console.log('✨ Done!');
console.log('');
console.log('📋 Next steps:');
console.log('   1. Sửa BUSINESS.md → business logic của project');
console.log('   2. Sửa CLAUDE.md → tech stack + build commands');
console.log('   3. Sửa .claude/settings.json → đúng MEMORY_FILE_PATH');
console.log('   4. (Optional) Sửa tests/business-rules/rules.test.ts');
console.log('   5. Mở Claude Code → nó hiểu biz!');
console.log('');
console.log('📌 Commands:');
console.log('   /impact      — Phân tích ảnh hưởng trước khi sửa code');
console.log('   /biz-review  — Review code vs business rules');
console.log('   /biz-init    — Tạo BUSINESS.md từ đầu (hỏi-đáp)');
console.log('');
console.log(`📚 Skills installed: ${selectedSkills.length}/${allSkills.length}`);
console.log(`   Xem tất cả: node ${join(brainRoot, 'scripts/setup-project.mjs')} --list`);
