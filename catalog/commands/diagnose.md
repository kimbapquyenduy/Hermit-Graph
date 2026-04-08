# Diagnose — Chẩn Đoán & Sửa Lỗi

Systematic debugging workflow: từ triệu chứng đến root cause, fix, và lưu vào KG.

## Quy trình

### 1. Thu thập triệu chứng
Hỏi user:
- Error message / stack trace là gì?
- Repro steps (làm thế nào để tái hiện)?
- Lỗi xuất hiện từ khi nào / sau thay đổi gì?
- Môi trường: dev / staging / production?

### 2. Tìm kiếm memory
Gọi `search_nodes` với các keyword từ error message để tìm incident tương tự đã gặp:
- Tìm theo error type, module, service liên quan
- Nếu tìm thấy → so sánh pattern, có thể áp dụng fix cũ không?
- Nếu không → tiếp tục phân tích mới

### 3. Phân tích root cause (5 Whys)
Áp dụng kỹ thuật 5 Whys:
- Why 1: Tại sao lỗi này xảy ra?
- Why 2: Tại sao nguyên nhân đó tồn tại?
- Why 3: Tại sao... (tiếp tục đến khi đến gốc rễ)
- Kết luận: Root cause thực sự là gì?

### 4. Hướng dẫn fix
- Đề xuất fix cụ thể với code snippet nếu có
- Kiểm tra fix không tạo regression
- CHỜ user confirm trước khi implement

### 5. Lưu vào memory
Sau khi fix xong → tạo entity incident:
```
create_entities([{
  name: "INCIDENT:ProjectName:BugDescription",
  entityType: "incident-bug",
  observations: [
    "SYMPTOM: <mô tả triệu chứng>",
    "ROOT_CAUSE: <nguyên nhân gốc rễ>",
    "FIX: <cách sửa, file đã thay đổi>",
    "FILES: <danh sách files liên quan>",
    "TIME: <khi nào phát hiện, môi trường>",
    "PROJECT: <tên project / module>"
  ]
}])
```

### 6. Tạo relations
```
create_relations([{
  from: "INCIDENT:ProjectName:BugDescription",
  to: "BIZ:ProjectName",
  relationType: "found_in"
}])
```

## Output format

```
## Diagnosis Report: [mô tả lỗi ngắn]

### Symptom
[Mô tả triệu chứng, error message]

### Root Cause
[Nguyên nhân gốc rễ qua 5 Whys]

### Fix
[Giải pháp + code snippet]

### Prevention
[Cách tránh lỗi tương tự trong tương lai]

### Saved to Memory
INCIDENT:ProjectName:BugDescription ✅
```
