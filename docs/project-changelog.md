# Project Changelog — Hermit Graph

All notable changes to Hermit Graph are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en.1.1.0/).

---

## [4.2.1] — 2026-04-13

### Fixed

- Session module missing from all documentation (README, system-architecture, codebase-summary)
- Module count in docs now correctly shows 6 modules / 22 tools + 1 resource

---

## [4.2.0] — 2026-04-13

### Added

#### Cross-Agent Session Context (2 new files)
- `scripts/lib/session-module.mjs` (123 LOC) — MCP tool + resource for auto-context loading
  - `hermit_session_start` — Detects project scope from CWD, returns relevant entities + branch + graph stats
  - `hermit://context/auto` — MCP resource returning markdown-formatted session context
- `scripts/lib/session-recall.mjs` (191 LOC) — Scope detection, keyword matching, entity scoring engine
  - Matches CWD against entity project scopes for targeted recall
  - Scoring: scope match weight + keyword relevance + recency bonus

#### Skill Distribution System (3 new files)
- `scripts/lib/skill-adapters.mjs` (90 LOC) — Agent configs + transforms for 4 agents
  - **Claude** — per-file copy to `.claude/skills/{name}/SKILL.md`
  - **Cursor** — per-file wrap as `.cursor/rules/hermit-{name}.mdc` (MDC frontmatter)
  - **Gemini** — merge-single into `GEMINI.md` with section markers
  - **Codex** — merge-single into `AGENTS.md` with section markers
- `scripts/lib/skill-export.mjs` (166 LOC) — Export engine (discover, compat check, write strategies, backup)
  - Per-file: mkdir + writeFile (Claude, Cursor)
  - Merge-single: section markers `<!-- hermit:skill:{name} start/end -->` for idempotent merge (Gemini, Codex)
  - Backup: `.hermit/backups/{filename}.bak` per export batch
- `scripts/lib/skills-module.mjs` (106 LOC) — 2 MCP tools: `hermit_skill_list` + `hermit_skill_export`
- **CLI:** `hermit skills export <name|--all> --agent <agent> [--project /path] [--global]`

#### Rules File Setup (non-Claude agents)
- `templates/hermit-rules.md` — Shared rules template for non-Claude agents
- `scripts/setup-project.mjs` — New `installRulesFile()` for agent-specific formats:
  - Cursor → `.cursor/rules/hermit.mdc` (MDC frontmatter)
  - Windsurf → `.windsurfrules` (append with separator)
  - Cline → `.clinerules` (standalone file)
  - Codex → `AGENTS.md` (standalone file)

### Changed

- `hermit-mcp-server.mjs` registers 2 new modules (session-module + skills-module) — now 6 modules total
- `kg-auto-recall.cjs` reads `MEMORY_FILE_PATH` from `~/.claude/settings.json` MCP config as fallback
- `brain-cli.mjs` — `await run(args)` fix for async skill manager
- `.gitignore` — Added `.npmrc`

### Fixed

- Code review fixes applied: C1 (backup overwrite), C2 (partial failure), H1 (compat gate key check), H2 (path validation), M1 (MDC escaping), M2 (skip names), M4 (newline normalization)

### Testing

- **Main suite:** 36/36 tests passing (version 4.2.0, 21 tools)
- **E2E skill distribution:** 36/36 assertions (discovery, all 4 agents, idempotent merge, backup, error handling)
- **Session module:** Manual verification (scope detection, JSON-RPC, resource, setup for Cursor/Windsurf)

---

## [4.1.0] — 2026-04-09

### Added

- In-process GitNexus LocalBackend as execution tier 0 (zero IPC overhead)
- Brain mtime cache for repeated reads
- TTL cache layer + output formatters for codegraph module

### Performance

| Metric | Before | After | Speedup |
|--------|--------|-------|---------|
| `hermit_context` | 303ms | 36ms | 8.4x |
| `hermit_impact` | 303ms | 66ms | 4.6x |
| Brain repeated reads | 6ms | 0.3ms | 22x |

### Changed

- `engines` field bumped to Node >=20 (ESM dynamic import required)
- `unified-search.mjs` updated for positional args + new GitNexus output format

---

## [4.0.0] — 2026-04-09

### Added

- **Unified MCP server** (`hermit-mcp-server.mjs`) — single entry point, 19 tools across 4 modules
  - Memory Module (10 tools) — KG CRUD: create/search/get/update/delete/list/bulk-import/export/relations
  - CodeGraph Module (4 tools) — GitNexus wrapper: query/context/impact/detect-changes
  - Intelligence Module (3 tools) — audit-trail/consolidate/branch-context
  - Unified Search (2 tools) — cross-KG + code search, health checks
- **Module registration pattern** — each module exports `register(server, ctx)`, loaded sequentially
- **Server-side observation validation** — universal for all agents (not just Claude hooks)
- `kg-write-validator.cjs` hook added to catalog (optional Claude Code layer)
- Modularized `scripts/lib/` — 11 focused modules extracted from monolithic v3 scripts

### Removed

- 7 obsolete v3 scripts: `launch-memory-mcp.mjs`, `launch-conventions-mcp.mjs`, `launch-memory-mcp.cmd`, `fix-brain-format.mjs`, old test/migration files
- Two separate MCP servers replaced by single unified server

### Breaking Changes

- MCP server entry point changed from `launch-memory-mcp.mjs` to `hermit-mcp-server.mjs`
- Tool names changed from `search_nodes`/`create_entities` to `hermit_search_entities`/`hermit_create_entities` (hermit prefix)
- Requires data migration: `node scripts/migrate-v3-to-v4.mjs`

### Testing

- **Total Tests:** 36/36 passing (comprehensive v4 test suite)

---

## [3.1.0] — 2026-04-08

### Added

- **Multi-agent setup:** `hermit setup --agent <cursor|windsurf|cline|codex>` configures any AI agent
- **Auto-detect:** Detects agent from project files (`.cursor/` → Cursor, `.claude/` → Claude)
- **MCP-only mode:** `hermit setup --mcp-only` prints generic MCP config for any agent
- **Skills catalog:** `catalog/` directory with 6 skills, 14 commands, 1 hook (git-tracked source)
- **Skills manager:** `hermit skills [list|add|remove|info|installed]` for individual skill management
- `resolve-brain-path.mjs` — detects git-clone vs npm-install for brain.jsonl path resolution
- npm publish metadata (files, keywords, repository, engines)

### Changed

- README rewritten with multi-agent setup guide and agent comparison table
- Non-Claude agents get MCP config + brain.jsonl + BUSINESS.md (no skills/commands/hooks)
- Claude gets full package (skills, commands, hooks, CLAUDE.md, auto-recall/save hooks)

---

## [3.0.0] — 2026-04-08

### Added (Competitive Evolution Phase)

#### Phase 1: Lightweight Semantic Search
- **Feature:** Hybrid semantic + keyword search for brain.jsonl entities
- **Model:** `@huggingface/transformers` v4.0.1 with `Xenova/all-MiniLM-L6-v2` ONNX (384-dim, ~23MB)
- **Components:**
  - `scripts/lib/embedding-service.mjs` — Singleton embedding service (WASM inference, no Python)
  - `scripts/lib/semantic-search.mjs` — Hybrid search with 0.7 cosine + 0.3 keyword scoring
  - `scripts/build-embedding-index.mjs` — Index builder (automatic or manual rebuild)
  - `data/brain-embeddings.json` — Pre-computed embedding vectors (384-dim)
- **Performance:** Cold start ~3-5s (model load), warm search <100ms, embedding rebuild ~7s per 5K entities
- **Fallback:** Graceful degradation to keyword-only if model unavailable
- **Recall:** Hybrid scoring optimized for mixed semantic + literal query matches

#### Phase 2: Dashboard Upgrade
- **Enhancement:** Enhanced vis.js viewer with search, filter, edit capabilities
- **File:** `viewer/index.html` (upgraded, no new build tooling)
- **New Features:**
  - Real-time entity search by name/type/observation
  - EntityType filter dropdown
  - Confidence range slider (0-1.0)
  - Stale entity highlighting (observations >180d old)
  - Brain health metrics panel (score, stale%, orphan count, relation integrity)
  - Inline observation editor (POST to MCP if available)
  - Entity detail panel with full observation history
- **Performance:** Loads 500+ entities in <2s with virtual scrolling
- **UX:** Integrated search highlights, filter breadcrumbs, edit confirmations

#### Phase 3: Multi-Agent Protocol
- **Feature:** Enable concurrent read/write to brain.jsonl from multiple agents/MCP clients
- **Implementation:** Cross-process file locking via `scripts/lib/file-lock.mjs`
- **Components:**
  - POSIX fcntl (Linux/macOS) + Windows LockFileEx support
  - Configurable timeout (default 5s)
  - Lock-free reads (JSONL append-only), write-locked updates
  - Graceful error handling on lock contention
- **Safety:** Prevents concurrent writes; readers proceed without waiting
- **Use case:** Multiple MCP servers, CLI tools accessing brain.jsonl simultaneously

#### Phase 4: Branch-Aware KG
- **Feature:** Auto-resolve brain.jsonl conflicts on git merge
- **Components:**
  - `scripts/merge-brain-jsonl.mjs` — Custom git merge driver (3-way merge at entity level)
  - `.gitattributes` — Git merge driver configuration
- **Merge Strategy:**
  - Additions from both sides → keep both (union)
  - Same entity modified differently → mark for manual review
  - Post-merge validation: duplicate detection, relation integrity checks
- **Use Case:** Safely switch git branches with diverged brains, auto-merge where possible

#### Phase 5: Brain CLI Unification
- **Feature:** Single unified `brain` CLI entry point for all operations
- **File:** `scripts/brain-cli.mjs` (registered in `package.json` bin field)
- **Subcommands:**
  - `brain search <query>` — Hybrid semantic + keyword search (uses pre-computed embeddings)
  - `brain health` — Run 5-check diagnostics (entity count, stale%, index freshness, file lock, Neo4j sync)
  - `brain index [--force]` — Build/rebuild embedding index (auto-detects staleness)
  - `brain export` — Export MCP DB to brain.jsonl format
  - `brain stale` — Generate stale observation report (>180 days)
  - `brain serve` — Launch MCP memory server
  - `brain view` — Open dashboard viewer
  - `brain help` — Show CLI help and version
- **Integration:** Installed globally as `brain` command after `npm install`
- **Help:** Subcommand help + usage examples for all operations

### Changed

- Upgraded memory integration to support semantic search fallback chain
- Enhanced MCP server launch sequence (Phase 1 embeddings optional, keyword search always available)
- Updated `.gitattributes` for custom merge driver (brain.jsonl only)

### Fixed

- Semantic search fallback prevents crashes when model unavailable
- Multi-agent write conflicts properly serialized via file-lock
- Branch merge edge cases (orphaned relations, duplicate entities) handled by merge driver

### Performance

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Semantic search (warm) | N/A | <200ms | New |
| Index build (500 entities) | N/A | ~20-30s | New |
| Dashboard load | N/A | <2s | New |
| Test coverage | 34 passed | 49 passed | +44% |
| Multi-agent latency | N/A | <10ms lock contention | New |

### Dependencies Added

- `@huggingface/transformers@^4.0.1` — ONNX embedding model inference (pure JS/WASM, no Python required)

### Breaking Changes

None. All v2.3 USPs (4-tier taxonomy, confidence scoring, brain health, biz-guard) remain fully operational.

### Testing

- **Total Tests:** 49 passed, 0 failed, 0 skipped (up from 34)
- **Coverage:** Phase 1 (embedding + search), Phase 2 (filter/search), Phase 3 (concurrent write), Phase 4 (merge driver), Phase 5 (CLI routing)
- **Integration:** All 5 phases tested together end-to-end

### Security Considerations

- **Embeddings:** Model cached locally after download, offline inference (no API calls)
- **File-Lock:** Read-heavy optimized, write locks minimal duration
- **JSONL:** Source of truth, SQLite cache never synced to git
- **Branch Merge:** Custom driver validates relation integrity, prevents duplicate entity conflicts

---

## [2.3.0] — 2026-04-01

### Added (Final Polish Phase)

#### Core Features
- Tiered entity taxonomy: BIZ (domain/rules/flows/entities), PATTERN (code/arch/integration), TECH (stack/config/person/decision), INCIDENT (bug/gotcha)
- Confidence-scored observations with [confidence|YYYY-MM-DD] prefix (v2 naming)
- Brain health self-diagnostics: 5-check system (entity count, stale%, orphan%, relation integrity, confidence median)
- Business rule guard for impact analysis (`/biz-review` command)
- JSONL append-only storage model (git-trackable, zero database dependencies)

#### Knowledge Graph Features
- 500+ entity support
- Observation history with staleness detection (>180d = stale)
- Relation integrity validation
- Orphaned entity detection
- Health score calculation (0-100 scale)

#### CLI & Integration
- Memory MCP server (better-memory-mcp integration)
- Search nodes by keyword
- Recall functionality with entity details
- Entity creation/update/deletion

#### Documentation
- README with 3-step setup guide
- Convention templates for 4-tier taxonomy
- Global instructions template (CLAUDE.md)

### Performance

- Brain health check: <100ms for 500 entities
- Search: <50ms keyword match
- Entity creation: <20ms append to JSONL

### Testing

- Baseline test suite: 34 tests passing
- Coverage: Entity operations, search, health checks, serialization

### Known Limitations (Addressed in v3.0)

- Search is keyword-only (no semantic similarity)
- Dashboard is basic vis.js viewer (no filters/search UI)
- Single-user only (no multi-agent coordination)
- No branch-aware merge (manual conflict resolution on git switch)

---

## [2.2.0] — 2026-03-15

### Added

- GitNexus integration skeleton
- Code intelligence tooling framework
- Execution flow detection basics

### Changed

- Updated documentation for tool descriptions

---

## [2.1.0] — 2026-02-28

### Added

- Visual graph viewer (vis.js)
- Entity relationship visualization

---

## [2.0.0] — 2026-02-01

### Added

- JSONL storage model
- 4-tier taxonomy system
- Core MCP server integration
- Knowledge graph foundation

---

## [1.0.0] — 2026-01-15

### Added

- Initial release
- Basic memory storage
- Simple entity CRUD

---

## Unreleased

### Planned

- Persistent session module tests in test-v4.mjs
- Telemetry & observability dashboard
- Automated stale cleanup policies
- Multi-machine brain sync & backup

---

*Last updated: 2026-04-13 | Current version: 4.2.1*
