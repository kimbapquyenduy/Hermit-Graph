---
description: Nạp file vào Knowledge Graph
context: fork
---

# Ingest — Nạp Tài Liệu Vào Knowledge Graph

Đọc toàn bộ file (BRD/PRD/SRS/README/meeting notes) và extract TẤT CẢ knowledge vào KG.

## Quy trình

### 1. Đọc toàn bộ nội dung
- User paste nội dung HOẶC cung cấp đường dẫn file
- Đọc từ đầu đến cuối, không bỏ sót phần nào
- File lớn (>500 dòng) → xử lý từng section, mỗi section extract xong mới qua section tiếp theo

### 2. Extract TẤT CẢ items theo 4 tiers (BIZ trước)

**Tier BIZ — Business**
- `biz-domain`: Domain, subdomain, product area
- `biz-rule`: Mỗi business rule là 1 entity riêng biệt (KHÔNG gộp)
- `biz-flow`: Process flow, workflow, user journey
- `biz-entity`: Core data entity, object trong domain

**Tier PATTERN — Code & Architecture**
- `pattern-code`: Code pattern, design pattern, implementation approach
- `pattern-arch`: System architecture, component structure
- `pattern-integration`: External integration, API contract, protocol

**Tier TECH — Technology**
- `tech-stack`: Framework, library, tool, platform
- `tech-config`: Config, environment, infrastructure setting
- `tech-person`: Stakeholder, team member, role
- `tech-decision`: Architecture decision record (ADR), technology choice

**Tier INCIDENT — Bugs & Lessons**
- `incident-bug`: Known bug, defect, issue
- `incident-gotcha`: Gotcha, quirk, non-obvious behavior, lesson learned

### 3. Preview table trước khi lưu

Hiển thị bảng tóm tắt cho user review:

```
| # | Entity Name | Type | Observations Summary |
|---|-------------|------|----------------------|
| 1 | BIZ:ProjectName | biz-domain | E-commerce, VN market, B2C |
| 2 | RULE:Project:DiscountMax | biz-rule | Max 50% discount per order |
| 3 | FLOW:Checkout | biz-flow | Cart → Payment → Confirm |
...

Tổng: X entities, Y relations sẽ được tạo.
Tiếp tục lưu? (yes/no)
```

### 4. User confirms → batch save

Sau khi user confirm → lưu tất cả:
```
create_entities([...tất cả entities])
create_relations([...tất cả relations])
```

Dedup trước khi tạo: `search_nodes` với tên entity → nếu đã tồn tại thì `add_observations` thay vì tạo mới.

### 5. Output summary

```
## Ingest Complete

Nguồn: [tên file / tiêu đề tài liệu]

### Đã lưu
- X entities mới
- Y entities updated (add_observations)
- Z relations mới

### Breakdown theo tier
- BIZ: [n] entities
- PATTERN: [n] entities
- TECH: [n] entities
- INCIDENT: [n] entities
```

## 6 Quy tắc nghiêm ngặt

1. **NO skipping** — extract MỌI thông tin được đề cập, dù nhỏ
2. **NO merging rules** — mỗi business rule là 1 entity riêng, KHÔNG gộp nhiều rules vào 1 node
3. **NO abbreviating** — observations giữ nguyên chi tiết đầy đủ, không tóm tắt quá mức
4. **Search first** — `search_nodes` trước khi tạo entity mới để tránh duplicate
5. **Section by section** — file lớn thì xử lý từng section, không nhảy cóc
6. **Preserve language** — giữ nguyên thuật ngữ gốc, không dịch / thay đổi tên kỹ thuật

## Naming convention

- Domain: `BIZ:ProjectName`
- Rule: `RULE:Project:RuleName`
- Flow: `FLOW:FlowName`
- Entity: `ENTITY:EntityName`
- Pattern: `PATTERN:Name` hoặc `PATTERN:ARCH:Name` hoặc `PATTERN:INT:Name`
- Tech: `TECH:ToolName`
- Decision: `DECISION:Project:TopicName`
- Bug: `INCIDENT:ProjectName:BugDescription`
- Gotcha: `GOTCHA:Description`
