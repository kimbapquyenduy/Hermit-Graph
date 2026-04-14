---
description: "Knowledge graph memory management with v2 4-tier schema"
tags: "memory, knowledge-graph, recall, save, brain"
complexity: "moderate"
requires-tools: "mcp"
---
# Auto Memory — Knowledge Graph Management

## Purpose
Governs ALL memory save/recall operations using the v2 4-tier schema. Active from the start to the end of every session — no exceptions.

---

## When to Activate
**ALWAYS.** Every session, every task, before and after.

---

## 4-Tier Decision Tree

Before saving anything, classify using this tree:

1. Is it about business domain / rules / flows / entities? → **BIZ tier**
2. Is it a coding / architecture / integration pattern? → **PATTERN tier**
3. Is it tech stack / config / person / decision? → **TECH tier**
4. Is it a bug / gotcha / lesson learned? → **INCIDENT tier**

---

## Naming Convention — TIER:SCOPE:LABEL

| Tier | Examples |
|------|---------|
| BIZ | `BIZ:ProjectName`, `RULE:Project:RuleName`, `FLOW:Project:FlowName`, `ENTITY:Project:EntityName` |
| PATTERN | `PATTERN:PatternName`, `PATTERN:ARCH:Name`, `PATTERN:INT:ServiceName` |
| TECH | `TECH:ProjectName`, `TECH:Person:Name`, `TECH:Decision:Topic` |
| INCIDENT | `INCIDENT:Project:BugDesc`, `GOTCHA:Description` |

---

## Valid Entity Types (13 total)

| Tier | EntityType |
|------|-----------|
| BIZ | `biz-domain`, `biz-rule`, `biz-flow`, `biz-entity` |
| PATTERN | `pattern-code`, `pattern-arch`, `pattern-integration` |
| TECH | `tech-stack`, `tech-config`, `tech-person`, `tech-decision` |
| INCIDENT | `incident-bug`, `incident-gotcha` |

**No other entityTypes are valid.** Old types (project, person, lesson, decision, service, config, pattern) are deprecated.

---

## Minimum Observation Counts

| EntityType | Min | Required Keys |
|-----------|-----|--------------|
| `biz-domain` | 4 | WHAT, TARGET, REVENUE, STARTED |
| `biz-rule` | 4 | RULE, CONTEXT, VIOLATION, FILES |
| `biz-flow` | 4 | FLOW steps, TRIGGER, SIDE_EFFECTS, EDGE_CASE |
| `biz-entity` | 3 | FIELDS, STATUSES, CONSTRAINTS |
| `pattern-code` | 4 | WHAT, WHEN, HOW, USED_IN |
| `pattern-arch` | 4 | WHAT, WHEN, HOW, TRADEOFF |
| `pattern-integration` | 5 | SERVICE, AUTH, CALLBACK, GOTCHA, RETRY |
| `tech-stack` | 4 | FRONTEND, BACKEND, INFRA, CI_CD |
| `tech-config` | 3 | ENV, URLS, CREDENTIALS_HINT |
| `tech-person` | 3 | ROLE, PROJECTS, PREFERENCES |
| `tech-decision` | 5 | DECISION, REASON, TRADEOFF, ALTERNATIVES, DATE |
| `incident-bug` | 6 | SYMPTOM, ROOT_CAUSE, FIX, FILES, TIME, PROJECT |
| `incident-gotcha` | 4 | WHAT, IMPACT, FIX, APPLIES_TO |

---

## Observation Format — Key-Prefixed with Confidence & Date

All observations MUST use:
1. **`[confidence|date]` prefix** — bắt buộc cho mọi observation mới
2. **Key prefix** — mô tả loại thông tin

### Prefix Format

```
[0.8|2026-03-26] RULE: Discount max 50% for non-admin     # full prefix (REQUIRED for new obs)
[0.8] RULE: Discount max 50%                                # confidence only (legacy, accepted)
RULE: Discount max 50%                                       # no prefix (legacy, accepted)
```

### Confidence Levels

| Level | When to Use |
|-------|------------|
| `0.95` | User directly states a fact, verified info |
| `0.9` | Bug fixes (verified by testing) |
| `0.8` | Standard knowledge, default for most observations |
| `0.6` | Auto-detected patterns, unconfirmed conventions |
| `0.3-0.5` | Uncertain, needs verification |

### Date

Always use today's date (ISO 8601: `YYYY-MM-DD`). Re-confirmation → update date to today, bump confidence.

### Examples

```
[0.95|2026-03-26] WHAT: Single-endpoint proc gateway pattern
[0.8|2026-03-26] CONTEXT: Used in ShinWoo/GSF20 backend
[0.9|2026-03-26] RULE: Discount cannot exceed 50%
[0.8|2026-03-26] FLOW: PR → Budget Check → PO → GR → AP Invoice → Payment → GL
[0.9|2026-03-26] FIX: Add raw SQL migration ALTER TYPE ... ADD VALUE
[0.8|2026-03-26] TRIGGER: User submits order with shipped status
[0.9|2026-03-26] SYMPTOM: 500 error on /api/dso/callproc after deploy
[0.9|2026-03-26] ROOT_CAUSE: Missing Oracle pool config in production env
[0.8|2026-03-26] DETAIL: Applies to all Node.js + Oracle projects
```

### Stale Detection

- Observations >180 days old = **stale** → flagged for review
- Stale ≠ delete. Stale = flag for user to confirm or remove
- Run `/brain-health` to detect stale entries

---

## Before Save Checklist

1. Run `search_nodes` — avoid creating duplicates
2. Determine correct tier using the decision tree
3. Apply `TIER:SCOPE:LABEL` naming convention
4. Use correct `entityType` from the 13 valid types
5. Meet minimum observation count for that type
6. Use key-prefixed observations with `[confidence|date]` prefix
7. Create appropriate relations

---

## Relation Types (v2)

`has_rule`, `has_flow`, `has_entity`, `uses_tech`, `uses_pattern`, `leads`, `works_on`, `reviews`, `decided`, `used_in`, `extends`, `alternative_to`, `found_in`, `applies_to`, `decided_for`, `depends_on`, `triggers`, `part_of`, `input_to`, `output_of`

---

## Before Each Task — Recall

Before writing any code, run 2 steps:

### Step 1: Search memory
```
search_nodes with keywords relevant to the task
```
- Found relevant context → use it, do not reinvent
- Not found → continue, but remember to save after
- **For large documents** (BRD/PRD/spec >500 lines): run `/ingest` in **multiple passes** — first pass extracts main entities, second pass catches relationships and sub-entities. Use `search_nodes` between passes to avoid duplicates.

### Step 2: Read BUSINESS.md (if task involves business logic)
Check impact chain before coding.

**No output from search_nodes = not yet allowed to start coding.**

---

## After Each Task — Save

After completing the task, before reporting results, run this checklist:

### Q1: Any NEW entity/concept?
(new project, person, service, tech decision)
→ YES → `create_entities` immediately

Example:
```json
[{
  "name": "TECH:EduMVP",
  "entityType": "tech-stack",
  "observations": [
    "[0.8|2026-03-26] FRONTEND: Next.js 15 + React 18 + Tailwind",
    "[0.8|2026-03-26] BACKEND: Node.js + PostgreSQL",
    "[0.8|2026-03-26] INFRA: Docker + MinIO",
    "[0.8|2026-03-26] CI_CD: GitHub Actions"
  ]
}]
```

### Q2: Any NEW relationship?
(A uses B, A depends on B, person X leads project Y)
→ YES → `create_relations` immediately

Example:
```json
[{
  "from": "BIZ:EduMVP",
  "to": "TECH:EduMVP",
  "relationType": "uses_tech"
}]
```

### Q3: Any bug fix / pattern / gotcha worth remembering?
(fixed error, new pattern, config trick, gotcha)
→ YES → `create_entities` with `incident-bug` or `incident-gotcha` type

Example:
```json
[{
  "name": "INCIDENT:EduMVP:PrismaEnumMigration",
  "entityType": "incident-bug",
  "observations": [
    "[0.9|2026-03-26] SYMPTOM: Prisma does not auto-migrate enum changes on PostgreSQL",
    "[0.9|2026-03-26] ROOT_CAUSE: PostgreSQL enum types require explicit ALTER TYPE",
    "[0.9|2026-03-26] FIX: Create raw SQL migration ALTER TYPE ... ADD VALUE",
    "[0.9|2026-03-26] FILES: prisma/migrations/",
    "[0.9|2026-03-26] TIME: 2026-03-26",
    "[0.9|2026-03-26] PROJECT: EduMVP"
  ]
}]
```

---

## Auto-Detect — Save Without Being Asked

When these signals appear → save automatically:

| Signal | Action |
|--------|--------|
| User states a preference | Save observation to `tech-person` entity |
| Read package.json / README for first time | Save `tech-stack` + `biz-domain` entities |
| Bug fix took > 5 min | Save `incident-bug` entity |
| User explains a business rule | Save `biz-rule` entity |
| Discover architecture pattern | Save `pattern-arch` or `pattern-code` entity |
| Switch to new project | `search_nodes` first; if unknown → save `biz-domain` + `tech-stack` |
| `/ck:retro` completes | Extract insights: save hotspot files as `INCIDENT:Project:HotspotFileName` (`incident-gotcha`), velocity trend as observation on `TECH:ProjectName`, recurring patterns as `PATTERN:PatternName` |

---

## Recall Workflow

1. User asks about something → `search_nodes` with relevant keywords
2. Found → present results organized by tier (BIZ / PATTERN / TECH / INCIDENT)
3. Not found → inform user, offer to search with broader terms

---

## Node Formula — Quality Rules

### Rule 1: Không lười — mô tả ĐỦ để người chưa biết cũng hiểu
```
✗ Lười: "RULE: Discount max 50%"
✓ Đủ:  "RULE: Discount không được > 50% cho non-admin users. Admin có thể override qua /admin/discounts"
```

### Rule 2: Flow phải ghi ĐỦ STEPS — không được bỏ bước
```
✗ Lười: "FLOW: Order → Payment → Done"
✓ Đủ:  "FLOW: Browse → AddToCart → Checkout → SelectPayment → ProcessPayment → VerifyCallback → ConfirmOrder → SendEmail → UpdateInventory"
```

### Rule 3: Bug phải ghi đủ root cause + fix cụ thể
```
✗ Lười: "FIX: Fixed the tax calculation"
✓ Đủ:  "FIX: Add guard in calculateTax() at tax.ts:42 → if (discount >= subtotal) return 0; else return (subtotal - discount) * TAX_RATE"
```

### Rule 4: Integration phải ghi đủ endpoint, auth method, gotcha
```
✗ Lười: "SERVICE: VNPay payment"
✓ Đủ:  "SERVICE: VNPay → sandbox: sandbox.vnpay.vn/paymentv2/vpcpay.html | prod: pay.vnpay.vn | API version: 2.1.0"
```

### Rule 5: Decision phải ghi đủ alternatives đã xét
```
✗ Lười: "DECISION: Chose Supabase Auth"
✓ Đủ:  "ALTERNATIVES: Better-Auth (flexible nhưng setup lâu), NextAuth (popular nhưng không RLS), Clerk (tốt nhưng $25/mo)"
```

### Rule 6: Entity phải ghi đủ fields + constraints
```
✗ Lười: "FIELDS: id, name, email"
✓ Đủ:  "FIELDS: id (uuid, PK), email (unique, verified), role (enum: student|instructor|admin), subscriptionStatus (enum: trial|active|expired)"
```

---

## Sub-Entity Splitting

Nếu 1 entity có > 8 observations → TÁCH thành parent + children:
```
BIZ:ShopX (parent — overview only: WHAT, TARGET, REVENUE, STARTED)
  ├── RULE:ShopX:DiscountMax50
  ├── RULE:ShopX:ShippedNoCancel
  ├── FLOW:ShopX:OrderCheckout
  ├── ENTITY:ShopX:Order
  └── ENTITY:ShopX:Product
```
Mỗi child có 4-6 observations chi tiết. Link bằng relations: has_rule, has_flow, has_entity.

---

## Anti-Patterns (KHÔNG LÀM)

- ✗ Name quá ngắn: `"discount"` → search ra mọi thứ liên quan
- ✓ Name có prefix: `"RULE:ShopX:DiscountMax50"`
- ✗ Observations không có key: `["không được quá 50%"]`
- ✓ Observations có key: `["RULE: Discount max 50% for non-admin"]`
- ✗ entityType tự chế: `"rule"` hoặc `"business-rule"`
- ✓ entityType đúng danh sách: `"biz-rule"`
- ✗ Relation không rõ: `{relationType: "related"}`
- ✓ Relation cụ thể: `{relationType: "has_rule"}`
- ✗ Node trùng: tạo "VNPay" rồi lại tạo "PATTERN:INT:VNPay"
- ✓ Luôn search trước: `search_nodes("VNPay")` → có rồi thì `add_observations`

---

## Memory Hygiene (Weekly)

- `read_graph` → review what's in the brain
- Run `/brain-health` to detect stale entries (>180d), orphans, duplicates
- Delete stale entities (`delete_entities`)
- Add missing observations (`add_observations`)
- Re-confirm important facts → bump confidence + update date

---

## One-Line Summary

> **BEFORE task: search. AFTER task: save. ALWAYS. NO EXCEPTIONS.**
