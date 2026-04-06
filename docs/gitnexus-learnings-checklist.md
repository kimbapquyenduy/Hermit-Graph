# Checklist — Áp dụng learnings từ GitNexus

> Nguồn: Phân tích https://github.com/abhigyanpatwari/GitNexus (2026-03-28)
> Ưu tiên: 🔴 High | 🟡 Medium | 🟢 Low / Future

---

## 🔴 Cải tiến deep-scan skill (áp dụng ngay)

- [ ] **Phase 5: Step-numbered flows** — thêm `STEP_N:` prefix + `file:line` vào FLOW entities
  ```
  [0.8|date] STEP_1: validateCredentials (auth/validator.ts:42) — checks JWT format
  [0.8|date] STEP_2: lookupUser (user/repository.ts:89) — DB query by email
  [0.8|date] TERMINAL: saveSessionToken (db/session.ts:67) — writes to Redis
  [0.8|date] TRIGGER: POST /auth/login
  ```

- [ ] **Phase 7: Impact-typed relations** — thay `affects` bằng typed relations
  ```js
  { relationType: "WILL_BREAK_IF_CHANGED" }   // direct dependency
  { relationType: "LIKELY_AFFECTED" }           // indirect
  { relationType: "ENFORCES" }                  // rule → pattern
  ```
  Thêm observation: `BLAST_RADIUS:` và `RISK_LEVEL:` vào entities

- [ ] **Phase 0: Stale tracking** — lưu git commit hash sau mỗi scan
  ```
  [0.9|date] LAST_SCAN_COMMIT: abc123def456
  [0.9|date] SCAN_STATS: 42 files, 8 rules, 5 flows, 3 integrations
  ```
  Phase 0 check: `git rev-parse HEAD` → compare → prompt incremental if changed

- [ ] **Phase 4.5 mới: Community grouping** — cluster related symbols thành COMMUNITY entities
  ```js
  {
    name: "COMMUNITY:{Project}:{DomainName}",
    entityType: "pattern-arch",
    observations: [
      "[0.7|date] MEMBERS: {list functions/classes}",
      "[0.7|date] COHESION: HIGH — 80% calls stay within community",
      "[0.7|date] BOUNDARY: N external callers",
      "[0.7|date] FILES: src/auth/ (primary)"
    ]
  }
  ```

---

## 🔴 GUARDRAILS cho skills claude-code-brain

- [ ] Tạo file `.claude/GUARDRAILS.md` với explicit rules:
  - MUST chạy `/impact` trước khi sửa business logic
  - MUST warn nếu BLAST_RADIUS > 3 entities
  - MUST dùng `/remember` ngay khi user giải thích business rule (không đợi cuối session)
  - NEVER tạo duplicate entity (search trước)

---

## 🟡 Áp dụng cho MentorX / dự án khác

- [ ] **Hybrid BM25 + Semantic search** cho MentorX search feature
  - BM25 (keyword) + Vector embeddings (semantic) + Reciprocal Rank Fusion
  - Ref: `DECISION:ClaudeCodeBrain:SemanticSearch_vs_KeywordSearch` đã có research

- [ ] **Impact analysis tool** cho MentorX — trước khi sửa DB schema/API, trace affected flows
  - Pattern: query all FKs → find affected endpoints → flag HIGH risk

- [ ] **MCP tools pattern** — khi build AI-augmented tools, expose structured tools thay vì raw text
  - Template: `query`, `context`, `impact`, `detect_changes` là 4 tools cốt lõi

---

## 🟢 Future / Research

- [ ] **Knowledge Graph thay flat DB** — khi domain có nhiều quan hệ phức tạp
  - Evaluate: libsql + graph extension vs Neo4j vs LadybugDB vs current JSONL
  - Trigger: khi JSONL > 1000 entities và query performance degraded

- [ ] **Topological Sort + Parallel Processing** — áp dụng cho data pipelines
  - Kahn's algorithm: group tasks by dependency level → process level-by-level in parallel

- [ ] **Community Detection (Leiden algorithm)** — cho codebase analysis tools
  - Auto-discover business domains từ call graph topology

- [ ] **Incremental indexing với git commit hash** — zero-config cache invalidation

- [ ] **Process/execution flow tracing** — walk call graph từ entry point → terminus
  - Áp dụng cho: debugging tools, audit logs, API docs generation

---

## Notes

- deep-scan improvements: update `.claude/skills/deep-scan/SKILL.md`
- GUARDRAILS: check `.claude/rules/` trước khi tạo mới
- libsql: cân nhắc khi JSONL > 500 entities và query performance degraded
