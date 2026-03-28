# CLAUDE.md — Global Instructions (áp dụng cho MỌI project)

> File này đặt tại: %USERPROFILE%\.claude\CLAUDE.md
> Claude Code tự động đọc mỗi session, bất kể đang ở project nào.

## ⛔ GIỚI LUẬT BỘ NHỚ — BẮT BUỘC

### Quy tắc đặt tên Entity (v2)
- Format: **TIER:SCOPE:LABEL**
- BIZ: `BIZ:ProjectName`, `RULE:Project:RuleName`, `FLOW:Project:FlowName`, `ENTITY:Project:EntityName`
- PATTERN: `PATTERN:PatternName`, `PATTERN:ARCH:Name`, `PATTERN:INT:ServiceName`
- TECH: `TECH:ProjectName`, `TECH:Person:Name`, `TECH:Decision:Topic`
- INCIDENT: `INCIDENT:Project:BugDesc`, `GOTCHA:Description`

### EntityTypes hợp lệ (13 loại)
`biz-domain`, `biz-rule`, `biz-flow`, `biz-entity`, `pattern-code`, `pattern-arch`, `pattern-integration`, `tech-stack`, `tech-config`, `tech-person`, `tech-decision`, `incident-bug`, `incident-gotcha`

### TRƯỚC mỗi task:
1. **search_nodes** với keyword liên quan → dùng context cũ nếu có
2. Đọc **BUSINESS.md** nếu task liên quan business logic

### Observation Prefix — BẮT BUỘC
Mọi observation mới PHẢI có prefix `[confidence|YYYY-MM-DD]`:
- `[0.95|2026-03-26] RULE: Discount max 50%` — user trực tiếp nói, đã verify
- `[0.8|2026-03-26] WHAT: Payment gateway pattern` — kiến thức chuẩn, mặc định
- `[0.6|2026-03-26] PATTERN: Có vẻ dùng service layer` — auto-detect, chưa confirm
- Legacy observations không có prefix vẫn chấp nhận (treated as confidence 0.8)
- Stale: observations >180 ngày → flag review, không auto-delete

### SAU mỗi task — Xác định tier:
1. Về business domain/rules/flows? → **BIZ** tier (biz-domain/biz-rule/biz-flow/biz-entity)
2. Coding/architecture/integration pattern? → **PATTERN** tier (pattern-code/pattern-arch/pattern-integration)
3. Tech stack/config/person/decision? → **TECH** tier (tech-stack/tech-config/tech-person/tech-decision)
4. Bug/gotcha/lesson learned? → **INCIDENT** tier (incident-bug/incident-gotcha)

### TỰ ĐỘNG nhớ khi gặp signal:
- User nói preference → save observation
- Đọc config/README lần đầu → save `BIZ:ProjectName` (biz-domain) hoặc `TECH:ProjectName` (tech-stack)
- Fix bug > 5 phút → save `INCIDENT:Project:BugDesc` (incident-bug)
- User giải thích business rule → save `RULE:Project:RuleName` (biz-rule)
- Chuyển project mới → search + save nếu chưa biết

### KHÔNG nhớ:
- Fix typo, console.log, thay đổi cosmetic
- Thông tin tạm thời (debug output, test data)

## Commands có sẵn (12 lệnh)
- `/impact` — Phân tích ảnh hưởng trước khi sửa code
- `/biz-review` — Review code vs business rules
- `/biz-init` — Tạo BUSINESS.md cho project mới
- `/remember` — Lưu thông tin vào bộ nhớ (v2 naming)
- `/recall` — Tìm thông tin đã lưu
- `/brain-dump` — Tổng kết session, lưu hết những gì chưa lưu
- `/diagnose` — Debug vấn đề có hệ thống, lưu incident
- `/ingest` — Nạp file (BRD/PRD/README) vào Knowledge Graph
- `/tech-decision` — Ghi nhận quyết định kỹ thuật
- `/learn-project` — Phát hiện convention của project (v2.2)
- `/suggest-reuse` — Gợi ý tái sử dụng patterns từ project khác (v2.2)
- `/brain-health` — Kiểm tra sức khỏe bộ não, 5 checks, score 0-100 (v2.3)

## Auto-Trigger Rules (TỰ ĐỘNG, không cần user gõ command)
- Khi cd vào project mới (chưa có BIZ: node trong memory) → TỰ ĐỘNG đọc README/package.json → save TECH: + BIZ: node
- Khi user yêu cầu sửa code liên quan business logic → TỰ ĐỘNG chạy impact analysis trước khi code (biz-guard skill)
- Khi fix bug mất > 5 phút → TỰ ĐỘNG save BUG: entity sau khi fix
- Khi user giải thích business rule/flow → TỰ ĐỘNG save RULE:/FLOW: entity ngay lúc đó (không đợi cuối session)
- Khi user paste file/content dài chứa biz context → TỰ ĐỘNG suggest "/ingest để extract hết vào KG"
- Khi user hỏi "nên dùng gì" → TỰ ĐỘNG recall DECISION: + TECH: + PATTERN: trước khi đề xuất

## Nguyên tắc code
- Đọc BUSINESS.md trước khi sửa business logic
- Chạy /impact khi thay đổi ảnh hưởng nhiều module
- Tìm pattern cũ trong memory trước khi viết mới
- Lưu lesson mỗi khi fix bug khó
