---
description: Review code vs business rules
context: fork
---

# Business Review

Review code vừa sửa so với business rules.

## Quy trình

1. Đọc `BUSINESS.md` — lấy danh sách business rules
2. Đọc git diff (hoặc files vừa sửa)
3. Check từng thay đổi có vi phạm business rule nào không
4. Check có chain nào bị bỏ sót không

## Output format

```
## 📋 Business Review

### Thay đổi đã review
- file1.ts: [mô tả thay đổi]
- file2.ts: [mô tả thay đổi]

### Business Rules Check
| Rule | Status | Ghi chú |
|------|--------|---------|
| Discount max 50% | ✅ OK | Logic giữ nguyên |
| Tax trên post-discount | ⚠️ CHECK | File tax.ts chưa sửa |

### Impact Chain Check
| Chain | Files cần sửa | Đã sửa | Bỏ sót |
|-------|---------------|--------|--------|
| Pricing | 5 | 4 | ❌ email template |

### Kết luận
- ✅ Safe to merge / ⚠️ Cần sửa thêm / ❌ Có vấn đề
```
