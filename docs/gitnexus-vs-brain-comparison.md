# So sánh chi tiết: claude-code-brain vs GitNexus

> Date: 2026-03-28

---

## TL;DR — Khác nhau ở gốc rễ

| | **claude-code-brain** | **GitNexus** |
|--|--|--|
| **Giải quyết vấn đề gì?** | Claude quên hết giữa các session | Agent bị mù về code structure, break call chains |
| **Đối tượng của graph** | Knowledge của developer (rules, decisions, patterns) | Structure của codebase (functions, calls, imports) |
| **Intelligence đến từ đâu?** | Claude Code đọc → hiểu → lưu | Tree-sitter parse AST → tự động extract |
| **Scope** | Cross-project, global (tất cả dự án) | Per-repository (1 repo = 1 index) |
| **Ai dùng graph?** | Claude Code (via MCP memory tools) | Claude Code + Cursor + Windsurf (via MCP code tools) |

---

## Phân tích chi tiết từng dimension

### 1. Mục đích cốt lõi

**claude-code-brain** = **Developer's long-term memory**
```
Problem: Mỗi session mới, Claude Code không nhớ gì
Solution: JSONL Knowledge Graph lưu:
  - Business rules (RULE:ShopX:DiscountMax50)
  - Architectural decisions (DECISION:Project:SQLite_vs_Postgres)
  - Code patterns (PATTERN:JWTRefresh)
  - Incidents/bugs đã fix (BUG:WebCash:OracleTimeout)
  - Team conventions và preferences
```

**GitNexus** = **Codebase structural intelligence**
```
Problem: Agent không biết "sửa validateUser sẽ break gì"
Solution: AST graph lưu:
  - Tất cả functions/classes/interfaces
  - CALLS edges: validateUser → decodeToken → verifyExpiry
  - IMPORTS edges: auth.ts → jwt.ts → types.ts
  - Execution flows: POST /login → step1 → step2 → terminus
  - Blast radius: "3 callers WILL BREAK"
```

**Kết luận:** Hoàn toàn khác nhau. Không cạnh tranh — bổ sung cho nhau.

---

### 2. Cách data được tạo ra

| | **claude-code-brain** | **GitNexus** |
|--|--|--|
| **Ai tạo data?** | Claude Code (AI interpretation) | Tree-sitter (deterministic parser) |
| **Input** | Conversations, file reads, user explanations | Raw source code files |
| **Process** | Claude đọc → hiểu intent → lưu entity | AST → structure extraction → graph edges |
| **Accuracy** | ~85-90% (AI có thể sai) | ~95-99% (parser chính xác) |
| **Coverage** | Business context + technical context | Technical structure only |
| **Manual effort** | Zero (auto-trigger hoặc user say "remember") | Run `npx gitnexus analyze` (1 command) |

---

### 3. Data model

**claude-code-brain — Semantic KG:**
```
Entities: BIZ, RULE, FLOW, ENTITY, PATTERN, TECH, INCIDENT
Relations: affects, uses, built_with, has_data_model, integrates_with
Observations: Free-text với [confidence|date] prefix

Ví dụ:
RULE:MentorX:DiscountMax50
  → [0.95|2026-03-15] RULE: Discount không vượt 50% giá gốc
  → [0.9|2026-03-15] CONTEXT: Áp dụng khi user có role=student
  → [0.9|2026-03-15] FILES: src/services/pricing.service.ts:L42
```

**GitNexus — Structural KG:**
```
Nodes: Function, Class, Interface, File, Process, Community, Route
Relations: CALLS, IMPORTS, EXTENDS, IMPLEMENTS, STEP_IN_PROCESS
Properties: confidence: DOUBLE, step: INT, reason: STRING

Ví dụ:
Function(validateUser, filePath="auth/validator.ts", startLine=42)
  --[CALLS confidence=0.95]--> Function(decodeToken)
  --[STEP_IN_PROCESS step=3]--> Process(UserLogin)
```

**Sự khác biệt:**
- claude-code-brain: nodes = concepts/knowledge
- GitNexus: nodes = code artifacts

---

### 4. Query model

**claude-code-brain:**
```js
// Natural language, approximate
search_nodes("authentication pattern")
// → tìm PATTERN:JWTRefresh, RULE:Auth:TokenExpiry, FLOW:UserLogin
// Claude interpret kết quả → dùng để code

// Graph traverse (manual qua observations)
open_nodes(["BIZ:MentorX.me"])
// → đọc observations → Claude hiểu context
```

**GitNexus:**
```cypher
// Precise Cypher (graph DB native)
MATCH (caller)-[:CALLS]->(f:Function {name: 'validateUser'})
RETURN caller.name, caller.filePath

// Natural language wrapper
query("user authentication flow")
// → trả về structured JSON với processes + symbols
```

**Sự khác biệt:**
- claude-code-brain: queries → textual context cho Claude
- GitNexus: queries → structured data cho agents/tools

---

### 5. Search capability

| | **claude-code-brain** | **GitNexus** |
|--|--|--|
| **Keyword** | search_nodes() — BM25 trên entity names+obs | BM25 + FTS index |
| **Semantic** | ModernColBERT (optional, Python needed) | HuggingFace Transformers (optional) |
| **Graph traversal** | Không có (flat entity lookup) | Cypher: traverse N hops, filter by type |
| **Hybrid** | Dual-layer (keyword + vector) — đã research | Reciprocal Rank Fusion (production) |

**Gap:** claude-code-brain thiếu graph traversal. Mọi entity đều flat — không thể query "tất cả flows liên quan đến RULE:X".

---

### 6. Agent integration

**claude-code-brain:**
```
MCP Tools (15): create_entities, search_nodes, open_nodes,
               add_observations, create_relations, semantic_search...
Usage: Claude Code tự quyết định khi nào call (auto-trigger rules)
Pattern: Passive memory — lưu khi có new knowledge, recall khi cần
```

**GitNexus:**
```
MCP Tools (7): query, cypher, context, impact, detect_changes, rename, list_repos
Usage: Agent gọi explicit trước mỗi edit
Pattern: Active guardrails — MUST call impact() before ANY edit
Hooks: PreToolUse (augment search), PostToolUse (re-index after commit)
```

**Sự khác biệt:**
- claude-code-brain: memory layer (passive, background)
- GitNexus: safety layer (active, blocking)

---

### 7. Privacy & storage model

| | **claude-code-brain** | **GitNexus** |
|--|--|--|
| **Format** | JSONL flat file | LadybugDB (binary, custom graph DB) |
| **Location** | 1 file/brain per installation | 1 `.gitnexus/` per repository |
| **Server** | `@sockeye44/better-memory-mcp` (npm run) | `gitnexus mcp` (CLI spawn) |
| **Privacy** | Local only | Local only (zero-upload) |
| **Portability** | Copy 1 JSONL file | Copy `.gitnexus/` directory |
| **Size** | ~50KB per 500 entities | ~50-150MB per 10k symbols |
| **Viewer** | HTML viewer (vis.js) hoặc Neo4j | Web UI (Sigma.js) hoặc browser WASM |

---

### 8. Thứ mình CÓ mà GitNexus KHÔNG CÓ

1. **Cross-project memory** — nhớ patterns từ WebCash khi làm MentorX
2. **Business rules & decisions** — GitNexus không lưu "discount max 50%", chỉ lưu code structure
3. **Human context** — team conventions, người responsible, tech decisions với rationale
4. **Incident tracking** — bugs đã fix, gotchas, lessons learned
5. **Confidence decay** — knowledge cũ tự động stale sau 180 ngày
6. **Non-code knowledge** — ingest BRD/PRD/README vào KG
7. **Zero re-indexing** — không cần chạy lại khi code thay đổi

### 9. Thứ GitNexus CÓ mà mình KHÔNG CÓ

1. **Call graph chính xác** — biết function X gọi function Y (100% accurate)
2. **Blast radius analysis** — "sửa validateUser sẽ break 3 callers"
3. **Execution flow tracing** — step-by-step từ entry point đến terminus
4. **Community detection** — auto-cluster "Auth module", "Payment module"
5. **Multi-file rename** — safe refactoring across entire codebase
6. **Git diff analysis** — detect_changes → affected processes
7. **Dead code detection** — functions không có callers
8. **Graph traversal queries** — Cypher N-hop queries

---

## Kết luận: Complementary, not competing

```
GitNexus answers:          "How does this code WORK?"
claude-code-brain answers: "What should I KNOW about this project?"

Combined = Agent hiểu cả CODE và BUSINESS
```

### Ideal workflow (cả hai cùng dùng):

```
1. User: "Thêm discount validation vào checkout"
2. claude-code-brain → recall: RULE:DiscountMax50, PATTERN:CheckoutFlow
3. GitNexus impact    → "applyDiscount() có 4 callers, RISK: HIGH"
4. Agent code với đầy đủ context: biết rule + biết blast radius
```

---

## Cơ hội tích hợp

- GitNexus community labels → auto-import vào claude-code-brain entities
- GitNexus impact data → enrich BLAST_RADIUS observations
- deep-scan skill → call `gitnexus context` thay vì đọc file manually

## Unresolved questions

1. Ship claude-code-brain với `.mcp.json` template kết nối cả hai?
2. GitNexus PolyForm Noncommercial license — restrict commercial use nếu integrate?
3. libsql tốt hơn JSONL khi scale > 1000 entities?
