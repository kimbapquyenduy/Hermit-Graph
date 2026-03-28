# 🧠 Claude Code Brain v2.3 — Bộ Não Cho Claude Code

> Copy thư mục này vào máy → 5 phút setup → Claude Code có trí nhớ vĩnh viễn
> **v2.3: Semantic Search + Auto-Learn + Cross-Project + Brain Hygiene**

## Cài đặt nhanh (5 phút)

### Bước 1: Copy thư mục
Copy toàn bộ thư mục `claude-code-brain` vào máy (ví dụ: `D:\AI\claude-code-brain`)

### Bước 2: Cài dependencies
```cmd
cd D:\AI\claude-code-brain
npm install
```

### Bước 3: Config Claude Code
Copy nội dung `.claude-settings.json` vào file `%USERPROFILE%\.claude\settings.json`
(Tạo thư mục `.claude` nếu chưa có)

⚠️ Sửa đường dẫn MEMORY_FILE_PATH và DATA_DIR cho đúng vị trí thư mục trên máy bạn

### Bước 4: (Tùy chọn) Setup Semantic Search + Auto-Learn
```cmd
npm run setup:semantic     # Python + PyTorch cho semantic search
npm run setup:conventions  # uv/pip cho auto-learn conventions
# Hoặc cài tất cả:
npm run setup:all
```

### Bước 5: Dùng Claude Code
Mở terminal bất kỳ project nào → `claude` → Nó tự nhớ mọi thứ!

## Xem Knowledge Graph

### Option A: HTML Viewer (không cần Docker, đơn giản nhất)
Mở file `viewer/index.html` trong browser → Click "Load File" → Chọn `data/brain.jsonl`

### Option B: Neo4j Browser (đẹp hơn, cần Docker)
1. Cài Docker Desktop
2. `cd docker && docker compose up -d`
3. Mở http://localhost:7474
4. Copy `.env.example` thành `.env`, sửa password (`brainpassword`)
5. `npm run sync` → Data vào Neo4j → Xem graph trong Neo4j Browser

## Cách dùng hàng ngày
1. Mở Claude Code trong bất kỳ project → nó tự nhớ context từ mọi project khác
2. Cuối ngày: mở viewer/index.html xem brain đã học được gì
3. (Tùy chọn) `npm run sync` để đẩy data vào Neo4j xem graph đẹp hơn

## 4-Tier Naming Convention (v2)

| Tier | Prefix | EntityTypes | Ví dụ |
|------|--------|-------------|-------|
| BIZ | `BIZ:`, `RULE:`, `FLOW:`, `ENTITY:` | biz-domain, biz-rule, biz-flow, biz-entity | `BIZ:ShopX`, `RULE:ShopX:DiscountMax50` |
| PATTERN | `PATTERN:`, `PATTERN:ARCH:`, `PATTERN:INT:` | pattern-code, pattern-arch, pattern-integration | `PATTERN:JWTRefresh`, `PATTERN:INT:VNPay` |
| TECH | `TECH:`, `PERSON:`, `DECISION:` | tech-stack, tech-config, tech-person, tech-decision | `TECH:EduMVP`, `PERSON:AnhMinh` |
| INCIDENT | `INCIDENT:`, `GOTCHA:`, `BUG:` | incident-bug, incident-gotcha | `BUG:RLS:20260325`, `GOTCHA:PrismaEnum` |

## Commands (12 lệnh)

| Command | Mô tả |
|---------|-------|
| `/impact` | Phân tích ảnh hưởng trước khi sửa code |
| `/biz-review` | Review code vs business rules |
| `/biz-init` | Tạo BUSINESS.md cho project mới |
| `/remember` | Lưu thông tin vào bộ nhớ (v2 naming) |
| `/recall` | Tìm thông tin đã lưu |
| `/brain-dump` | Tổng kết session, lưu hết |
| `/diagnose` | Debug vấn đề có hệ thống, lưu incident |
| `/ingest` | Nạp file (BRD/PRD/README) vào KG |
| `/tech-decision` | Ghi nhận quyết định kỹ thuật |
| `/learn-project` | Phát hiện convention của project (v2.2) |
| `/suggest-reuse` | Gợi ý patterns từ project khác (v2.2) |
| `/brain-health` | Kiểm tra sức khỏe bộ não — 5 checks, score 0-100 (v2.3) |

## Skills (7 skill)

| Skill | Mô tả |
|-------|-------|
| auto-memory | Quản lý save/recall theo 4-tier schema |
| biz-guard | Check business impact trước khi code |
| code-patterns | Phát hiện & lưu coding patterns |
| api-design | Hướng dẫn thiết kế API nhất quán |
| db-migrations | An toàn khi chạy database migrations |
| security-check | Security review checklist |
| tech-advisor | Tư vấn tech stack & so sánh |

## v2.1-2.3 Features

### Semantic Search (Phase 3)
- MCP server: `@sockeye44/better-memory-mcp` (drop-in replacement, 15 tools)
- ModernColBERT neural embeddings — tìm "authentication patterns" → ra `PATTERN:JWTAuth`
- Yêu cầu: Python 3.8+, PyTorch (~500MB model). Fallback keyword search nếu không có Python
- Setup: `npm run setup:semantic`
- **Mặc định: TẮT** (dùng `search_nodes` + Claude đủ tốt cho <500 entities)

#### Bật Semantic Search khi brain lớn (>500 entities):
Đổi memory config trong `~/.claude/.mcp.json` từ npx sang launcher:
```json
"memory": {
  "command": "node",
  "args": ["<path>/scripts/launch-memory-mcp.mjs"],
  "env": {
    "MEMORY_FILE_PATH": "<path>/data/brain.jsonl",
    "HF_HUB_DISABLE_SYMLINKS_WARNING": "1"
  }
}
```
Launcher tự fix Python PATH + spawn better-memory-mcp với semantic search enabled.
Restart Claude Code session sau khi đổi config.

### Auto-Learn Conventions (Phase 4)
- MCP server phụ: `enhanced-mcp-memory` (SQLite, chạy song song)
- Tự phát hiện: naming convention, import style, build tools, linting
- Command `/learn-project` — scan project, detect conventions, lưu `PATTERN:ARCH:*`
- Setup: `npm run setup:conventions`

### Cross-Project Intelligence (Phase 5)
- Command `/suggest-reuse` — tìm patterns từ project khác có thể tái sử dụng
- Rank theo confidence score, filter by decay threshold 0.3
- Link pattern vào project hiện tại qua `uses_pattern` relation

### Confidence & Temporal (v2.1)
- Observation prefix: `[confidence|YYYY-MM-DD]` — bắt buộc cho mọi observation mới
- Stale detection: observations >180 ngày → flag review
- Decay formula: `confidence * e^(-0.01 * days)`
- Tools: `npm run backfill` (thêm prefix cho data cũ), `npm run stale` (báo cáo stale)

### Brain Hygiene (v2.3)
- Command `/brain-health` — 5 automated checks, health score 0-100
- Checks: stale entries, duplicates, orphan nodes, low confidence, missing relations
- Viewer: health badge in header bar (color-coded score)
- CLI: `npm run health` — run checks on brain.jsonl, exit code 0 if healthy

## Test
```cmd
npm test
```
11 tests: JSONL validation, entity counts, settings JSON, viewer, skills/commands, confidence parsing, stale detection, semantic config, conventions config, cross-project, brain health.

## Migration từ v1
Nếu bạn có brain.jsonl cũ (v1 format):
```cmd
npm run migrate
```
Script tự convert entity names + entityTypes sang v2 format.

## Cấu trúc thư mục
```
claude-code-brain/
├── data/
│   ├── brain.jsonl              ← Memory file (Claude Code ghi vào đây)
│   ├── brain-sample.jsonl       ← Sample data (v2 format)
│   └── brain-v1-backup.jsonl    ← Backup trước migration
├── scripts/
│   ├── sync-to-neo4j.mjs        ← Sync brain → Neo4j
│   ├── test.mjs                 ← Test script (11 tests)
│   ├── setup-project.mjs        ← Setup biz-guard cho project mới
│   ├── setup-semantic.mjs       ← Setup Python + PyTorch (v2.2)
│   ├── setup-conventions.mjs    ← Setup uv + enhanced-mcp-memory (v2.2)
│   ├── backfill-confidence.mjs  ← Backfill [confidence|date] prefix (v2.1)
│   ├── stale-report.mjs         ← Report stale observations (v2.1)
│   ├── lib/parse-observation.mjs ← Shared parser module (v2.1)
│   ├── brain-health.mjs         ← Brain health check (v2.3)
│   ├── migrate-brain-v1-to-v2.mjs ← Migration script v1→v2
│   └── clean-skills.mjs         ← Xóa YAML frontmatter khỏi skills
├── viewer/
│   └── index.html               ← Graph viewer (vis.js, dark theme)
├── docker/
│   └── docker-compose.yml       ← Neo4j (optional)
├── templates/
│   ├── global-CLAUDE.md         ← Template cho ~/.claude/CLAUDE.md
│   ├── BUSINESS.md              ← Template business impact map
│   └── CLAUDE.md                ← Template per-project instructions
├── .claude/
│   ├── skills/                  ← 7 skills (auto-memory, biz-guard, ...)
│   └── commands/                ← 12 commands (impact, brain-health, learn-project, ...)
├── .claude-settings.json        ← Config template (Dual MCP + Stop Hook)
├── .env.example                 ← Neo4j config template
├── package.json
└── README.md
```

## FAQ
Q: Claude Code không nhớ gì?
A: Kiểm tra file settings.json đã copy đúng chưa, path MEMORY_FILE_PATH đúng chưa

Q: Viewer không hiện gì?
A: Kiểm tra file brain.jsonl có data chưa (dùng brain-sample.jsonl để test)

Q: Sync lỗi kết nối Neo4j?
A: Kiểm tra Docker đang chạy, .env đúng password (`brainpassword`)
