/**
 * Business MD Generator — pre-fills BUSINESS.md with auto-detected project info.
 * Uses scanProject() output to populate Domain + Tech Stack sections.
 * Remaining sections kept as editable templates.
 */

import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Generate BUSINESS.md content with pre-filled Domain + Tech Stack.
 * @param {object} info — output from scanProject()
 * @returns {string}
 */
export function generateBusinessMd(info) {
  const domain = info.description || info.name || 'Unnamed project';
  const frontend = info.frontend?.length ? info.frontend.join(', ') : 'N/A';
  const backend = info.backend?.length ? info.backend.join(', ') : 'N/A';
  const lang = info.language || 'N/A';
  const build = info.tools?.length ? info.tools.join(', ') : 'N/A';
  const infra = info.infra?.length ? info.infra.join(', ') : 'N/A';

  return `# BUSINESS.md — Business Impact Map

> ⚠️ AI Agent: ĐỌC FILE NÀY TRƯỚC KHI SỬA BẤT KỲ BUSINESS LOGIC NÀO
> Sửa 1 chỗ có thể ảnh hưởng nhiều chỗ khác. Kiểm tra impact chain TRƯỚC khi code.

## Domain
${domain}

## Tech Stack
- Language: ${lang}
- Frontend: ${frontend}
- Backend: ${backend}
- Database: [...]
- Build Tools: ${build}
- Infrastructure: ${infra}

## Core Entities
| Entity | Mô tả | File chính |
|--------|--------|------------|
| [Entity] | [Description] | \`src/models/entity.ts\` |

---

## 🔴 High-Impact Chains

### Chain: [Name]
> [Description of chain impact]

- \`src/services/example.ts\` — [What it does]
  - ⚡ IMPACTS:
    - \`src/services/dependent.ts\` — [Why]
  - 🧪 MUST TEST:
    - [Test scenario]

---

## 📋 Business Rules (KHÔNG ĐƯỢC PHÁ VỠ)

### [Category]
1. [Rule description]

---

## 🔄 Status Flows

### [Entity] Status
\`\`\`
[status flow diagram]
\`\`\`

---

## 📝 Lessons Learned
> Thêm vào đây mỗi khi phát hiện impact mới hoặc bug do biz logic

- [Date] [Description]
`;
}

/**
 * Write BUSINESS.md if it doesn't exist, using auto-detected project info.
 * @param {string} projectRoot
 * @param {object} info — from scanProject()
 * @returns {{ created: boolean, path: string }}
 */
export function writeBusinessMdIfMissing(projectRoot, info) {
  if (!existsSync(projectRoot)) return { created: false, path: join(projectRoot, 'BUSINESS.md') };
  const dst = join(projectRoot, 'BUSINESS.md');
  if (existsSync(dst)) return { created: false, path: dst };
  const content = generateBusinessMd(info);
  writeFileSync(dst, content);
  return { created: true, path: dst };
}
