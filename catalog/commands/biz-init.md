# Business Init

Khởi tạo BUSINESS.md cho project mới. Hỏi user để map toàn bộ business logic.

## Quy trình

Hỏi user lần lượt:

### 1. Business domain
"Project này làm gì? Domain chính là gì?"

### 2. Core entities
"Các entity chính? (VD: User, Order, Product, Payment...)"

### 3. Critical flows
"Các flow quan trọng nhất? (VD: checkout, payment, refund...)"

### 4. Business rules
"Có rules cứng nào không được phá? (VD: discount max 50%, order đã ship không cancel...)"

### 5. Impact chains
Với mỗi flow, hỏi: "Sửa [X] thì phải sửa thêm những đâu?"

## Output

Tạo file `BUSINESS.md` ở root project với format:

```markdown
# BUSINESS.md — Business Impact Map

> ⚠️ Claude Code: ĐỌC FILE NÀY TRƯỚC KHI SỬA BẤT KỲ BUSINESS LOGIC NÀO

## Domain
[mô tả]

## Core Entities
- Entity1 — [mô tả]
- Entity2 — [mô tả]

## 🔴 High-Impact Chains

### [Tên chain 1]
- `path/to/source.ts` — [mô tả]
  - ⚡ IMPACTS:
    - `path/to/file1.ts` — [lý do]
    - `path/to/file2.ts` — [lý do]
  - 🧪 MUST TEST: [scenarios]

## 📋 Business Rules
1. [rule 1]
2. [rule 2]

## 🔄 Status Flows
- [Entity]: status1 → status2 → status3
  - Trigger: [gì trigger chuyển status]
  - Side effects: [gì xảy ra khi chuyển]
```

Sau khi tạo xong → nhắc user: "Mỗi khi phát hiện chain mới, hãy bảo tôi cập nhật BUSINESS.md"
