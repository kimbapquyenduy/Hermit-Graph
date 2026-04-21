---
description: "Impact-aware coding guard — run hermit_impact before editing exported or framework-bound symbols"
tags: "refactor, edit, impact, risk, guard, codegraph"
complexity: "simple"
requires-tools: "mcp-hermit"
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.py"
---

# Code Guard — Impact-Aware Coding Skill

## Purpose
Prevent silent regressions when modifying shared or framework-dispatched code. Before
editing any exported function / class / method (or route handler / middleware / job),
check the transitive caller graph via `hermit_impact` so surprises are caught before
the edit lands.

AST call-graph analysis finds transitive breakage that Grep cannot. Framework-bound
symbols (controller methods, middleware `handle`, job `run`) show 0 AST callers but
are heavily invoked by string dispatch — this skill directs you to grep route/config
files in that case.

## When to activate

This skill activates when the user asks for any of the following:
- "edit X", "change X", "modify X", "refactor X", "rename X", "delete X"
- "update the signature of X", "extract X into Y"
- "fix the bug in <function name>"
- Any reference to a *function*, *class*, *method*, or *module name* as the edit target

It also activates when the assistant itself decides to edit source code, not just
documentation or configuration.

## Workflow (bắt buộc)

### Bước 1: Identify target symbol
Xác định chính xác ký hiệu sẽ thay đổi. Nếu user nói "edit the auth function", hỏi
lại hoặc dùng `hermit_query({query: "auth"})` để định vị trước.

### Bước 2: Check impact
Call `hermit_impact({target: "<name>", direction: "upstream", cwd: "<project>"})`.
(Nếu `hermit_context` đã được gọi trước đó và trả về Impact Preview với d=1/d=2/d=3
counts + risk — không cần gọi lại; thông tin đã có.)

Đọc output:
- **d=1 WILL_BREAK** — direct callers. Tất cả phải update nếu signature thay đổi.
- **d=2 LIKELY_AFFECTED** — indirect. Cần test.
- **d=3 MAY_NEED_TESTING** — transitive. Test nếu nằm trong critical path.
- **Risk: LOW / MEDIUM / HIGH** — quick gate.
- **Framework binding hint** — nếu xuất hiện, symbol được framework dispatch; grep
  thêm routes/config để tìm string-based callers.

### Bước 3: Report to user BEFORE editing
Nếu d=1 > 0 hoặc framework-bound: báo cáo ngắn gọn:
```
Impact: <symbol>
- d=1 WILL_BREAK: N callers — [list top 3]
- Risk: MEDIUM
- Framework-bound: yes/no
```

Nếu d=1 > 5 hoặc Risk ≥ HIGH: hỏi user *"Do you want to see the full caller list before proceeding?"* trước khi edit.

### Bước 4: Apply the edit
Thực hiện edit. Nếu non-trivial, include tóm tắt impact trong commit message
(ví dụ: *"refactor: rename validateUser — 5 direct callers updated"*).

### Bước 5 (optional): Verify
Sau edit, có thể chạy `hermit_detect_changes({cwd: "<project>"})` để xác nhận
graph đã đồng bộ.

## Skip when

Bỏ qua impact check cho các edit trivial:
- Single-line typo fixes
- Comment-only changes
- Docstring updates
- Adding log statements inside a function body (không thay đổi contract)
- Symbol is NOT exported AND NOT framework-bound (pure internal helper)
- User explicitly says "just do it", "skip the check", "trust me"

## Cost

- 1 extra tool call per edit-intent session (~30ms cached, ~50ms fresh)
- Adds 4-5 lines to response explaining impact
- Zero impact on internal-only helpers (no call issued)
- Complements `biz-guard` (different dimension: business rules vs call graph)

## Example — VI session

```
User: "Refactor hàm updatePassword trong UserController"
Assistant:
  1. hermit_impact({target: "UserController.updatePassword", direction: "upstream"})
     → d=1:0, Risk: LOW, framework-bound (controller method)
  2. Hint says grep routes — run `grep "updatePassword" start/routes.js`
     → 1 hit: `Route.post("updatepassword", "UserController.updatePassword")`
  3. Report to user:
     "Impact LOW (0 AST callers). Framework-bound — only route binding at routes.js:48.
     Safe to rename atomically: UserController method + route string."
  4. Apply edits.
```

## Example — EN session

```
User: "Change the signature of validateUser to add a tenantId param"
Assistant:
  1. hermit_impact({target: "validateUser", direction: "upstream"})
     → d=1:12, d=2:34, Risk: HIGH
  2. Report: "Impact HIGH — 12 direct callers. Want full list before proceeding?"
  3. User: "yes"
  4. Show full caller list, propose migration strategy (add param with default, then remove).
```
