---
description: Ghi nhận quyết định kỹ thuật
context: inline
---

# Tech Decision — Ghi Lại & Tra Cứu Quyết Định Kỹ Thuật

Record và retrieve technology/architecture decisions vào KG để không bao giờ quên tại sao team chọn X thay vì Y.

## Quy trình

### 1. Tra cứu quyết định cũ
Trước tiên, `search_nodes` để xem đã có decision nào liên quan chưa:
- Tìm theo topic, technology name, project
- Nếu tìm thấy → hiển thị decision cũ, hỏi user: cập nhật hay tạo decision mới?

### 2. Thu thập context
Hỏi user:
- Vấn đề cần giải quyết là gì?
- Các lựa chọn đã cân nhắc là gì?
- Constraints (thời gian, team skill, budget, performance...)?
- Ai là decision maker / stakeholders?

### 3. Đánh giá các options

Hiển thị pros/cons matrix:

```
| Option | Pros | Cons | Fit Score |
|--------|------|------|-----------|
| Option A | ... | ... | 8/10 |
| Option B | ... | ... | 6/10 |
| Option C | ... | ... | 4/10 |
```

CHỜ user confirm lựa chọn cuối cùng.

### 4. Lưu vào memory

Sau khi user xác nhận decision:
```
create_entities([{
  name: "DECISION:Project:TopicName",
  entityType: "tech-decision",
  observations: [
    "DECISION: <lựa chọn được chọn>",
    "REASON: <lý do chính>",
    "TRADEOFF: <đánh đổi chấp nhận>",
    "ALTERNATIVES: <các option bị loại và lý do>",
    "DATE: <ngày quyết định, ai quyết định>"
  ]
}])
```

### 5. Tạo relations

```
create_relations([
  {
    from: "DECISION:Project:TopicName",
    to: "TECH:ChosenTechnology",
    relationType: "decided_for"
  },
  {
    from: "DECISION:Project:TopicName",
    to: "TECH:RejectedOption",
    relationType: "alternative_to"
  }
])
```

## Output format

```
## Decision Record: [topic]

### Context
[Vấn đề cần giải quyết]

### Options Evaluated
| Option | Pros | Cons |
|--------|------|------|
| ...    | ...  | ...  |

### Decision
**Chosen:** [lựa chọn]
**Reason:** [lý do]
**Tradeoffs accepted:** [đánh đổi]

### Alternatives Rejected
- [Option X]: [lý do loại]
- [Option Y]: [lý do loại]

### Saved to Memory
DECISION:Project:TopicName ✅
```

## Ví dụ

User: "/tech-decision chọn database cho MentorX"

→ search_nodes("database MentorX decision") → không có
→ Thu thập: vấn đề là cần DB cho education platform, options: PostgreSQL / MongoDB / MySQL
→ Đánh giá → PostgreSQL được chọn
→ Tạo entity `DECISION:MentorX:DatabaseChoice` với 5 observations
→ Relation: `decided_for` → `TECH:PostgreSQL`, `alternative_to` → `TECH:MongoDB`
