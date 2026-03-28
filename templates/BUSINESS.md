# BUSINESS.md — Business Impact Map

> ⚠️ Claude Code: ĐỌC FILE NÀY TRƯỚC KHI SỬA BẤT KỲ BUSINESS LOGIC NÀO
> Sửa 1 chỗ có thể ảnh hưởng nhiều chỗ khác. Kiểm tra impact chain TRƯỚC khi code.

## Domain
[Mô tả ngắn project làm gì, phục vụ ai]

## Tech Stack
- Frontend: [...]
- Backend: [...]
- Database: [...]
- Infrastructure: [...]

## Core Entities
| Entity | Mô tả | File chính |
|--------|--------|------------|
| User | Người dùng hệ thống | `src/models/user.ts` |
| Order | Đơn hàng | `src/models/order.ts` |
| Product | Sản phẩm | `src/models/product.ts` |
| Payment | Thanh toán | `src/models/payment.ts` |

---

## 🔴 High-Impact Chains

### Chain: Pricing / Discount
> Sửa giá hoặc discount → ảnh hưởng invoice, tax, report, email

- `src/services/pricing.ts` — Tính giá gốc
  - ⚡ IMPACTS:
    - `src/services/discount.ts` — Logic discount
    - `src/services/tax.ts` — Tính thuế (trên giá sau discount)
    - `src/services/invoice.ts` — Tổng tiền invoice
    - `src/components/CartSummary.tsx` — Hiển thị giá UI
    - `src/emails/order-confirmation.hbs` — Email template
    - `src/reports/revenue.ts` — Báo cáo doanh thu
  - 🧪 MUST TEST: 
    - Checkout flow end-to-end
    - Invoice PDF generation
    - Tax calculation với nhiều discount cases
    - Email content đúng giá

### Chain: User Roles & Permissions
> Thêm/sửa role → ảnh hưởng tất cả route guards, menu, API access

- `src/config/roles.ts` — Define roles & permissions
  - ⚡ IMPACTS:
    - `src/middleware/auth.ts` — Route guards
    - `src/components/Sidebar.tsx` — Menu visibility
    - `src/api/*/index.ts` — Mọi API endpoint có checkPermission()
    - `src/services/audit.ts` — Audit log
  - 🧪 MUST TEST:
    - Login từng role, check menu hiện đúng
    - API access denied cho wrong role
    - Audit log ghi đúng

### Chain: Order Status Flow
> Thêm/sửa status → ảnh hưởng notification, inventory, webhook, UI

- Status flow: `draft → pending → confirmed → shipping → delivered → completed`
- Cancel flow: `pending/confirmed → cancelled`
  - ⚡ IMPACTS khi thêm/sửa status:
    - `src/services/order-state-machine.ts` — Transitions hợp lệ
    - `src/services/notification.ts` — Trigger email/SMS theo status
    - `src/services/inventory.ts` — Reserve khi confirmed, release khi cancel
    - `src/components/OrderTimeline.tsx` — UI timeline
    - `src/api/webhook.ts` — Partner webhook payloads
  - 🧪 MUST TEST:
    - Full order lifecycle (draft → completed)
    - Cancel flow (kiểm tra inventory release)
    - Webhook payload format

### Chain: Payment
> Sửa payment → ảnh hưởng checkout, refund, reconciliation

- `src/services/payment.ts` — Xử lý payment
  - ⚡ IMPACTS:
    - `src/services/checkout.ts` — Checkout flow
    - `src/services/refund.ts` — Refund logic
    - `src/services/reconciliation.ts` — Đối soát
    - `src/api/webhook/payment.ts` — Payment gateway callback
  - 🧪 MUST TEST:
    - Payment success → order confirmed
    - Payment fail → order stays pending
    - Refund → inventory restored

### Chain: Product Catalog
> Thêm/sửa product field → ảnh hưởng DB, API, search, cart, order

- `src/models/product.ts` — Product schema
  - ⚡ IMPACTS:
    - DB migration (new field → migration file)
    - `src/api/products.ts` — API response shape
    - `src/services/search.ts` — Search index mapping
    - `src/services/cart.ts` — Cart item logic
    - `src/components/ProductCard.tsx` — UI display
  - 🧪 MUST TEST:
    - API response có field mới
    - Search trả kết quả đúng
    - Cart tính toán đúng

---

## 📋 Business Rules (KHÔNG ĐƯỢC PHÁ VỠ)

### Pricing
1. Discount KHÔNG ĐƯỢC > 50% trừ khi role = admin
2. Tax = VAT 10% trên (subtotal - discount), KHÔNG trên subtotal
3. Shipping fee miễn phí khi order > [X] VND
4. Invoice total = subtotal - discount + tax + shipping

### Order
5. Order đã confirmed KHÔNG ĐƯỢC cancel nếu đã shipping
6. Inventory phải reserve khi confirmed, release khi cancel
7. Email confirmation PHẢI gửi trong 5s sau order confirmed
8. Order quá 30 phút chưa payment → auto cancel

### User
9. Email phải unique, không cho phép đổi sau khi verify
10. Password phải >= 8 chars, có uppercase + number
11. Account bị lock sau 5 lần login sai liên tiếp

### Payment
12. Refund KHÔNG ĐƯỢC > original payment amount
13. Partial refund allowed, nhưng tổng refund ≤ paid amount
14. Payment callback phải verify signature trước khi xử lý

---

## 🔄 Status Flows

### Order Status
```
draft ──→ pending ──→ confirmed ──→ shipping ──→ delivered ──→ completed
                 │         │
                 └─────────┴──→ cancelled
```
| Transition | Trigger | Side Effect |
|-----------|---------|-------------|
| draft → pending | User submit | Validate stock |
| pending → confirmed | Payment success | Reserve inventory, send email |
| confirmed → shipping | Admin ship | Update tracking, send SMS |
| shipping → delivered | Carrier confirm | Send review request email |
| delivered → completed | Auto after 7 days | Release funds to seller |
| → cancelled | User/Admin/Timeout | Release inventory, refund if paid |

### Payment Status
```
pending ──→ processing ──→ success ──→ refunded (partial/full)
                    │
                    └──→ failed
```

---

## 📝 Lessons Learned
> Thêm vào đây mỗi khi phát hiện impact mới hoặc bug do biz logic

- [Ngày] [Mô tả lesson]
