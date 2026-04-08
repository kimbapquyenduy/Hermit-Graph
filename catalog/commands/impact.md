# Impact Check

Phân tích ảnh hưởng trước khi sửa code.

## Quy trình

1. Đọc `BUSINESS.md` (hoặc BUSINESS IMPACT MAP trong `CLAUDE.md`)
2. Xác định thay đổi thuộc business chain nào
3. Liệt kê TẤT CẢ files bị ảnh hưởng (trực tiếp + gián tiếp)
4. Liệt kê business rules KHÔNG ĐƯỢC phá vỡ
5. Đề xuất test cần chạy

## Output format

```
## 🔍 Impact Analysis: [tên thay đổi]

### Chain: [tên business chain]

### Files ảnh hưởng trực tiếp
| File | Thay đổi | Lý do |
|------|----------|-------|
| path/to/file.ts | Sửa logic X | Vì Y |

### Files ảnh hưởng gián tiếp (ripple)
| File | Cần check | Lý do |
|------|-----------|-------|
| path/to/other.ts | Data format | Input từ file trên |

### ⛔ Business Rules KHÔNG ĐƯỢC phá
1. [rule]
2. [rule]

### 🧪 Test bắt buộc
1. [test scenario]
2. [test scenario]

### ⏱️ Ước lượng
- Số files cần sửa: X
- Độ phức tạp: Low/Medium/High
- Rủi ro: Low/Medium/High
```

Sau khi output → **CHỜ user confirm** rồi mới code.
