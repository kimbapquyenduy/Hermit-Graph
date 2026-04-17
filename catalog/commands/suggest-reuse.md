---
description: Gợi ý tái sử dụng patterns
context: fork
---

# Suggest Reuse — Gợi Ý Tái Sử Dụng Từ Dự Án Khác

Search brain for reusable patterns, solutions, and integrations from other projects.

## Input
$ARGUMENTS — project name or context keywords (optional; auto-detects if empty)

## Quy trình

### 1. Identify current project
- If $ARGUMENTS provided → `search_nodes` with that name
- If empty → check cwd for package.json, README, .git → extract project name
- If still unknown → ask user: "Đang làm project gì?"
- Find matching `BIZ:*` entity in brain

### 2. Get current project context
- `open_nodes` for the BIZ:* entity
- List related entities (patterns, tech stack, integrations, decisions)
- Extract keywords: tech names, pattern names, domain terms

### 3. Search for reusable patterns
- For each keyword from current project:
  - `search_nodes(keyword)` → collect results
- Filter results:
  - KEEP: `PATTERN:*`, `INCIDENT:*`, `DECISION:*` entities
  - REMOVE: entities already linked to current project
  - REMOVE: `BIZ:*` entities (want patterns, not projects)
- Deduplicate results

### 4. Rank suggestions
- Sort by confidence score (from `[confidence|date]` prefix)
- Apply confidence threshold: skip if decayed confidence < 0.3
- Limit to top 5

### 5. Present results
For each suggestion:
- Entity name + entityType
- Source project (find via relations: which BIZ:* is it linked to?)
- Confidence score + date learned
- First 1-2 observations as preview
- Why relevant (which keyword matched)

If 0 results: "Không tìm thấy patterns từ projects khác. Thử /remember để lưu patterns."

### 6. Offer to link
- "Link pattern nào vào project hiện tại không?"
- If yes → `create_relations`: `BIZ:CurrentProject` → `uses_pattern` → `PATTERN:Suggested`

## Output format
```
Cross-Project Suggestions for BIZ:MentorX
=========================================

1. PATTERN:JWTAuth (from BIZ:ProjectAlpha)
   Confidence: 0.85 | Learned: 2026-03-20
   "Access token 15min expiry, refresh token rotation, HttpOnly cookie"
   Relevance: Project cũng cần authentication

2. GOTCHA:PrismaEnumMigration (applies to all Prisma + PostgreSQL)
   Confidence: 0.9 | Learned: 2026-03-25
   "Prisma doesn't auto-migrate enum changes on PostgreSQL"
   Relevance: Project dùng PostgreSQL

Found 2 reusable patterns from 1 other project.
```

## Edge cases
- Brain chỉ có 1 project → "Chưa đủ data cross-project. Hãy dùng Claude Code ở nhiều project hơn."
- Current project chưa có trong brain → "Chạy /biz-init trước để đăng ký project."
- Tất cả patterns đã linked → "Tất cả patterns đã được link rồi."
