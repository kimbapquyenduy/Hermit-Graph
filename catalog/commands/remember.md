---
description: Lưu thông tin vào MCP Memory KG
context: inline
---

# Remember — Lưu Vào Bộ Não

Lưu thông tin vào MCP Memory KG.

## Quy trình
1. Phân tích thông tin user muốn lưu
2. Xác định entity type theo v2 schema (biz-domain / biz-rule / biz-flow / biz-entity / pattern-code / pattern-arch / pattern-integration / tech-stack / tech-config / tech-person / tech-decision / incident-bug / incident-gotcha)
3. Đặt tên theo format `TIER:SCOPE:LABEL` (xem bên dưới)
4. `search_nodes` trước để tránh duplicate
5. Tạo entity + observations bằng `create_entities`
6. Tạo relations nếu có liên kết (`create_relations`)
7. Confirm đã lưu

## Naming convention

| Tier | Format | Ví dụ |
|------|--------|-------|
| BIZ domain | `BIZ:ProjectName` | `BIZ:ProjectAlpha` |
| BIZ rule | `RULE:Project:RuleName` | `RULE:ProjectAlpha:DiscountMax` |
| BIZ flow | `FLOW:FlowName` | `FLOW:Checkout` |
| BIZ entity | `ENTITY:EntityName` | `ENTITY:Order` |
| PATTERN | `PATTERN:Name` | `PATTERN:JWTAuth` |
| PATTERN arch | `PATTERN:ARCH:Name` | `PATTERN:ARCH:ServiceLayer` |
| PATTERN integration | `PATTERN:INT:Name` | `PATTERN:INT:Integration_VNPay` |
| TECH stack | `TECH:ToolName` | `TECH:NextJS` |
| TECH person | `TECH:Person:Name` | `TECH:Person:AnhMinh` |
| TECH decision | `DECISION:Project:Topic` | `DECISION:ProjectAlpha:DatabaseChoice` |
| INCIDENT bug | `INCIDENT:Project:BugDesc` | `INCIDENT:ProjectAlpha:LoginCrash` |
| INCIDENT gotcha | `GOTCHA:Description` | `GOTCHA:VNPay_IPN_Required` |

## Ví dụ
User: "/remember Project Alpha dùng Next.js 15, Prisma, deploy Vercel, lead là anh Minh"

→ Tạo:
- Entity `TECH:NextJS15` (tech-stack): ["React framework v15", "App Router", "Deploy on Vercel"]
- Entity `BIZ:ProjectAlpha` (biz-domain): ["Uses Next.js 15", "Prisma ORM", "Deploy on Vercel"]
- Entity `TECH:Person:AnhMinh` (tech-person): ["Tech Lead of ProjectAlpha"]
- Relation: `TECH:Person:AnhMinh` → leads → `BIZ:ProjectAlpha`
- Relation: `BIZ:ProjectAlpha` → built_with → `TECH:NextJS15`
