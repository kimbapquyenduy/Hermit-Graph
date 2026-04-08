# Recall — Hồi Tưởng Từ Bộ Não

Tìm kiếm thông tin đã lưu trong MCP Memory KG.

## Quy trình
1. Gọi `search_nodes` với keyword từ user
2. Nếu tìm thấy → trình bày kết quả gọn gàng
3. Nếu không tìm thấy → thông báo và gợi ý keyword khác
4. Nếu cần chi tiết → gọi `open_nodes` với tên entity cụ thể

## Ví dụ
User: "/recall VNPay"

→ search_nodes("VNPay") → Trả về:
```
🧠 Tìm thấy trong bộ nhớ:

📦 VNPay (service)
  - Payment gateway for Vietnam
  - Sandbox URL: sandbox.vnpay.vn
  - IPN callback required

🔗 Relationships:
  - ProjectAlpha → uses → VNPay
```
