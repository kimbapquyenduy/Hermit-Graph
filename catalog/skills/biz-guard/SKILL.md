---
description: "Business-aware coding guard — validates changes against business rules before editing"
tags: "business, rules, guard, validation, impact"
complexity: "moderate"
requires-tools: "file-ops, mcp"
---
# Biz Guard — Business-Aware Coding Skill

## Mục đích
Đảm bảo Claude Code **hiểu business context** trước khi sửa code. Tránh sửa 1 chỗ mà phá vỡ business logic ở chỗ khác.

## Khi nào kích hoạt
Skill này kích hoạt khi user yêu cầu:
- Sửa/thêm/xóa code liên quan business logic
- Refactor feature đang hoạt động
- Thay đổi data model, API response, pricing, permissions, order flow
- Bất kỳ thay đổi nào có thể ảnh hưởng nhiều module

## Workflow bắt buộc

### Bước 1: Đọc Business Impact Map
Trước khi viết BẤT KỲ dòng code nào, đọc file `BUSINESS.md` (hoặc section BUSINESS IMPACT MAP trong `CLAUDE.md`) ở root project.

Nếu file không tồn tại → **HỎI USER** mô tả business flow liên quan rồi tạo file.

### Bước 2: Impact Analysis
Xác định thay đổi thuộc chain nào trong Impact Map, sau đó output:

```
## 🔍 Impact Analysis

**Yêu cầu:** [mô tả ngắn]
**Business chain:** [tên chain]
**Files ảnh hưởng trực tiếp:**
- file1.ts — [lý do]
- file2.ts — [lý do]

**Files ảnh hưởng gián tiếp (ripple effect):**
- file3.ts — [lý do]

**Business rules cần giữ nguyên:**
- [rule 1]
- [rule 2]

**Test bắt buộc sau khi sửa:**
- [test 1]
- [test 2]
```

**CHỜ USER CONFIRM** trước khi tiếp tục.

### Bước 3: Implement với checklist
Sửa từng file trong danh sách Impact Analysis. Sau MỖI file:
- ✅ Check business rules có bị phá không
- ✅ Check data flow vào/ra có consistent không
- ✅ Check UI hiển thị đúng không

### Bước 4: Post-change verification
Sau khi sửa xong TẤT CẢ files:
1. Chạy tests liên quan (nếu có)
2. Review lại danh sách Impact Analysis → đã sửa hết chưa?
3. Kiểm tra BUSINESS.md có cần cập nhật không (flow mới, rule mới?)
4. Search memory (MCP) xem có lesson cũ liên quan không

### Bước 5: Lưu lesson
Nếu phát hiện impact chain MỚI (chưa có trong BUSINESS.md):
- Cập nhật BUSINESS.md
- Lưu vào MCP memory: `create_entities` + `add_observations`

**Lưu gotcha / incident** (dùng v2 schema):
```json
[{
  "name": "INCIDENT:ProjectName:ShortBugDesc",
  "entityType": "incident-gotcha",
  "observations": [
    "WHAT: Mô tả vấn đề phát hiện",
    "IMPACT: Ảnh hưởng đến flow nào",
    "FIX: Cách xử lý / phòng tránh",
    "APPLIES_TO: Các project / module liên quan"
  ]
}]
```

**Lưu business rule mới** (dùng v2 schema):
```json
[{
  "name": "RULE:ProjectName:RuleName",
  "entityType": "biz-rule",
  "observations": [
    "RULE: Phát biểu rule rõ ràng",
    "CONTEXT: Khi nào rule áp dụng",
    "VIOLATION: Hậu quả nếu vi phạm",
    "FILES: Các file enforce rule này"
  ]
}]
```

## Nguyên tắc
- **KHÔNG BAO GIỜ** sửa code mà không đọc Impact Map trước
- **KHÔNG BAO GIỜ** sửa chỉ 1 file khi Impact Map chỉ ra nhiều files
- **LUÔN HỎI** khi không chắc impact chain
- **LUÔN CẬP NHẬT** BUSINESS.md khi phát hiện chain mới
