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

## Future Roadmap (Post v3.0)

### v3.2 — Observability & DevOps (Proposed, Q2 2026)

**Scope (pending approval):**
- Telemetry dashboard (search volume, stale rates, entity growth)
- Automated stale entity cleanup (policy-driven)
- Backup & recovery (multi-machine brain sync)
- Performance profiling (index build, search latency tracking)

**Priority:** Medium (post v3.0 stabilization)

---

### v3.3 — IDE Integration (Research Phase)

**Scope (under investigation):**
- VSCode extension with inline brain suggestions
- Cursor.ai native integration (brain sidebar)
- GitHub Copilot chat integration
- JetBrains IDE plugin (IntelliJ, WebStorm, etc.)

**Priority:** Low (requires partner API access)

---

## Success Criteria

- v3.0 ships with all 5 phases complete and tested
- Competitive feature parity achieved vs top 3 projects
- No regressions vs v2.3 USPs (all 4-tier/confidence/health/biz-guard still operational)
- Zero database dependencies maintained
- Git-trackability preserved (JSONL append-only model)

---

## Dependencies & Blockers

**Current:** None blocking
**Notable:** Semantic search Phase 1 enables Phases 3 & 5; recommend sequential completion order: 1→2→4→3→5

---

## Related Documentation

- [project-changelog.md](project-changelog.md) — Detailed version history and change notes
- [system-architecture.md](system-architecture.md) — Technical architecture overview
- [code-standards.md](code-standards.md) — Development guidelines

---

*Last updated: 2026-04-08 | Status: v3.0 Complete*
