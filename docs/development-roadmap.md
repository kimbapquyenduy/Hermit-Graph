# Development Roadmap — Hermit Graph

## Overview

This roadmap tracks the evolution of Hermit Graph — a persistent memory system for Claude Code powered by a tiered Knowledge Graph. Each version builds on prior USPs (Unique Selling Points) while closing competitive gaps.

---

## Version History

### v2.3 — Final Polish (Q1 2026, Complete)

**Status:** Complete
**Completion Date:** 2026-04-01

**Deliverables:**
- Tiered entity taxonomy (BIZ/PATTERN/TECH/INCIDENT)
- Confidence-scored observations with [confidence|YYYY-MM-DD] prefix
- Brain health self-diagnostics (5-check health score 0-100)
- Business rule guard for impact analysis
- JSONL storage (git-friendly, zero database dependencies)

**Key Achievements:**
- All USPs operational and competitive vs 10+ known projects
- Baseline test suite passing (34 tests)
- Stable MCP server integration

**USPs (Unique vs Competitors):**
- Only project with 4-tier taxonomy
- Only project with confidence scoring
- Only project with brain health diagnostics
- Only project with biz-guard for rule checking
- JSONL = git-trackable, zero DB requirements

---

### v3.0 — Competitive Evolution (2026-04-08, Complete)

**Status:** Complete
**Completion Date:** 2026-04-08
**Branch:** `upgrade/cke-v2.14.0`

**Context:** Research into 10+ competitor projects (MegaMemory, agentmemory, MeMesh, memory-graph, etc.) identified critical gaps:
1. No semantic search (only keyword matching)
2. Basic dashboard (vis.js only, no filters/search)
3. No multi-agent coordination (single-user only)
4. No branch-aware KG merge (can't handle git branch switching)

**Deliverables (5 phases):**

| Phase | Name | Status | Effort | Key Outcome |
|-------|------|--------|--------|------------|
| 1 | Lightweight Semantic Search | ✅ Done | 2-3d | Hybrid BM25 + vector similarity, JS embeddings (no Python), 100% recall |
| 2 | Dashboard Upgrade | ✅ Done | 2d | Enhanced vis.js with search, filter, stale node indicators |
| 3 | Multi-Agent Protocol | ✅ Done | 2-3d | Cross-process file locking for concurrent read/write safety |
| 4 | Branch-Aware KG | ✅ Done | 1-2d | Custom git merge driver for brain.jsonl, .gitattributes configured |
| 5 | Brain CLI Unification | ✅ Done | 2d | Single `brain` CLI entry point with search, health, export, GitNexus integration |

**Key Metrics:**
- Test coverage: 49 passed, 0 failed, 0 skipped (44% improvement from v2.3)
- Semantic search recall: >80% on 500+ entities
- Dashboard load time: <2s with full KG
- Multi-agent concurrency: 2+ clients read/write safely via file-lock
- CLI commands: 7 unified subcommands (search, health, index, export, stale, code, serve)

**Implementation Summary (All Verified):**
- Phase 1: `scripts/lib/embedding-service.mjs` + `scripts/lib/semantic-search.mjs` + `scripts/build-embedding-index.mjs` for hybrid search
- Phase 2: `viewer/index.html` enhanced with search UI, stale node indicators (red border, 0.6 opacity)
- Phase 3: `scripts/lib/file-lock.mjs` (POSIX fcntl + Windows LockFileEx) for safe concurrent access
- Phase 4: `scripts/merge-brain-jsonl.mjs` custom merge driver + `.gitattributes` configuration
- Phase 5: `scripts/brain-cli.mjs` with 8 subcommands (search, health, index, export, stale, serve, view, help)

**Design Decisions (Confirmed):**
1. **Semantic Search** — Option A: JS in-process embeddings (no Python runtime, offline-first)
2. **Dashboard** — Option A: Upgrade existing vis.js (no build tooling added)
3. **Multi-Agent** — Option A: MCP shared mode + file-lock coordination
4. **Storage** — Keep JSONL as primary, optional SQLite cache for search indexing

**Risk Mitigation:**
- Semantic search fallback to keyword-only if embeddings unavailable
- File-lock is read-heavy optimized (write locks brief)
- JSONL performance at scale mitigated by SQLite cache layer (JSONL = source of truth)

---

### v4.0 — Unified MCP Architecture (2026-04-09, Complete)

**Status:** Complete
**Completion Date:** 2026-04-09

**Deliverables:**
- Unified MCP server (single entry point, 19→28 tools across 7 modules)
- Module registration pattern (`register(server, ctx)`)
- Memory Module (10 KG CRUD tools), CodeGraph Module (5 tools), Intelligence Module (3 tools)
- Unified Search (2 tools), Session Module (1 tool + 1 resource), Skills Module (6 tools)
- Skill Search tool with keyword scoring
- Cross-agent session context, skill distribution to 6 agents
- Command + hook export system with agent-specific adapters

**Key Metrics:**
- 36→98 tests passing across 4 sprints (v4.0→v5.0)
- 7 modules registered in single MCP server
- 6 agents supported (Claude, Cursor, Gemini, Cline, Codex, OpenCode)

---

### v5.0 — Smart Context & Multi-Agent (2026-04-14, Complete)

**Status:** Complete
**Completion Date:** 2026-04-15 (v5.1.1)

**Deliverables:**
- Token-aware KG injection (progressive detail: compact/standard/full)
- Smart skill activation via `paths:` frontmatter
- Post-response KG auto-update (6 regex extractors)
- KG context forwarding for subagents
- Zero-config multi-agent setup (`hermit setup` configures all 7 agents)
- Windsurf + OpenCode agent support (7 total)

**Key Metrics:**
- 98 tests passing
- 7 agents: Claude, Cursor, Gemini, Windsurf, Cline, Codex, OpenCode

---

### v6.0.0 — Built-in Code Intelligence (2026-04-15, Complete)

**Status:** Complete
**Completion Date:** 2026-04-15

**Deliverables:**
- **Removed GitNexus dependency** — all code intelligence built-in via ast-grep
- 10 code-intel modules in `scripts/lib/code-intel/` (parser, extractors JS/TS + Python, graph, impact, indexer, process-detector)
- Auto-indexing on first query, incremental indexing via git diff
- Process detection via DFS call chain tracing
- Unified search merging KG entities + code symbols

**Key Metrics:**
- 100 tests + 9 e2e code-intel tests
- Full index ~2s (85 files), queries <10ms, impact <20ms
- Zero external dependencies for code intelligence
- JS/TS built-in, Python via optional `@ast-grep/lang-python`

**Breaking Changes:**
- Deleted `gitnexus-runner.mjs` (296 LOC subprocess manager)
- Added `@ast-grep/napi` as bundled dependency

---

## Future Roadmap (Post v6.0)

### v6.1 — Observability & Quality (Proposed, Q2 2026)

**Scope (pending approval):**
- Telemetry dashboard (search volume, stale rates, entity growth)
- Automated stale entity cleanup (policy-driven)
- Performance profiling (index build, search latency tracking)
- Expand hook coverage (Windsurf + OpenCode auto-recall/update hooks)

**Priority:** Medium

---

### v7.0 — IDE Integration (Research Phase)

**Scope (under investigation):**
- VSCode extension with inline brain suggestions
- Cursor.ai native integration (brain sidebar)
- JetBrains IDE plugin (IntelliJ, WebStorm, etc.)
- Additional language support for code intelligence (Go, Rust, Java)

**Priority:** Low (requires partner API access)

---

## Success Criteria

- v6.0 ships with built-in code intelligence, zero external subprocess dependencies
- All v2.3 USPs preserved (4-tier taxonomy, confidence scoring, health diagnostics, biz-guard)
- 7-agent support operational
- 100+ tests passing
- Performance targets met (index <5s, queries <50ms)

---

## Related Documentation

- [project-changelog.md](project-changelog.md) — Detailed version history and change notes
- [system-architecture.md](system-architecture.md) — Technical architecture overview
- [codebase-summary.md](codebase-summary.md) — Codebase overview and module map

---

*Last updated: 2026-04-15 | Status: v6.0.0 Complete*
