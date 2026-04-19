# Project Changelog — Hermit Graph

All notable changes to Hermit Graph are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en.1.1.0/).

---

## [6.3.5] — 2026-04-19

### Fixed
- **MCP client string-arg coercion** — tool schemas now accept stringified primitives and JSON-stringified arrays from clients that serialize all args as strings (Cursor, Cline, certain bridges). Previously failed with `Invalid input: expected number/array, received string` on tools like `hermit_search_nodes { limit: 3 }`, `hermit_add_observations { observations: [...] }`, `hermit_create_entities { entities: [...] }`
- **New helper** — `scripts/lib/zod-coerce.mjs` exports `zNumber()`, `zBoolean()`, `zArray(inner, { min, max })` — coerces strings at parse boundary while preserving all constraints (min/max/enum/minLength)
- **Applied to 7 modules** — memory, intelligence, unified-search, skill-search, deep-scan, skills, setup. Zero behavior change for correctly-typed clients (Claude Code)

---

## [6.3.4] — 2026-04-17

### Fixed
- **Contact email** — updated CODE_OF_CONDUCT.md with correct maintainer email
- **Git history cleanup** — cleaned up stale branches and legacy files from history

---

## [6.3.3] — 2026-04-17

### Added
- **Viewer screenshots** in README — KG entity details, related traversal, CodeGraph impact analysis

### Fixed
- **Branch alignment** — local branch renamed from `master` to `main` to match GitHub default

---

## [6.3.2] — 2026-04-17

### Added
- **Community files** — SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md
- **GitHub config** — Issue templates (bug report, feature request), PR template, Dependabot config
- **LICENSE in npm** — Added to package.json files whitelist

### Fixed
- **npm image rendering** — OG image now uses absolute GitHub raw URL (was broken relative path)
- **Viewer CDN comments** — Added license attribution to Graphology and Sigma.js imports
- **.env.example** — Added security warning on default password

---

## [6.3.1] — 2026-04-17

### Added
- **Brand guidelines** (`docs/brand-guidelines.md`) — color palette, typography, logo usage, voice & tone, mascot guidelines
- **Brand assets** (`assets/brand/`) — OG image (1200x630), social preview (1280x640), logo concepts, design tokens (CSS + JSON)
- **Marketing articles** (`assets/articles/`) — 6 launch/promo drafts (HN, Reddit, tutorial, awesome-list, GitHub optimization)
- **Viewer favicons** — Both KG and CodeGraph viewers now show hermit crab favicon

### Improved
- **README** — Added OG image, npm downloads badge, "Before & After" comparison, "Who This Is For" section, "Get Started" CTA; removed version-specific "What's New" (changelog handles this)
- **npm discoverability** — Added 8 keywords: claude-code, gemini, gemini-cli, opencode, ast-grep, code-intelligence, mcp-server, developer-tools
- **KG viewer** — Title simplified to "Knowledge Graph"; file input hidden (uses Load button)
- **CodeGraph viewer** — Title simplified to "CodeGraph"

### Changed
- **Preflight script** — "What's New" README check now optional (skip instead of fail)

---

## [6.3.0] — 2026-04-17

### Added
- **CodeGraph Viewer** (`viewer/code-viewer.html`) — WebGL viewer for code symbols with file tree sidebar, color-by-kind/folder/language, impact blast radius with severity badges, collapsible detail panels, selection ring
- **Brain-Code bridge** — CodeGraph viewer auto-loads `brain.jsonl`, matches RULE/FLOW entities to code symbols by file path (3-strategy: exact, basename, partial), shows affected rules in detail + impact panels
- **Related entities** (KG viewer) — "Related" button performs BFS 2-hop traversal with edge dimming, depth-colored nodes
- **Deep Scan Collector** — `deep-scan-collector.mjs` for structured phase-based project scanning
- **`hermit view --code`** — CLI flag to open CodeGraph viewer
- **`npm run view:code`** — NPM script shortcut for CodeGraph viewer
- **Sidebar reopen button** — Floating tab when sidebar collapsed (CodeGraph viewer)
- **Node overlap resolution** — Collision detection pushes overlapping nodes apart every layout iteration

### Improved
- Force layout: weaker attraction, overlap resolution per iteration, stronger Spread button
- Selection ring uses correct Sigma.js v2 coordinate chain (raw graph coords → graphToViewport)
- Node size multipliers reduced (selected 1.15x, impact 1.2x) to prevent compounding
- KG viewer layout: wider initial spread, 3x area, 0.3x attraction
- CodeGraph layout: density-adaptive area multipliers increased, attraction halved

### Fixed
- Related mode not exiting when clicking different node
- Biz rules not matching code symbols (path matching too strict)
- Impact panel undefined `bizRules` variable

---

## [6.2.0] — 2026-04-17

### Added
- **Task-aware recall for all agents** — All 10 recall hook files (claude, cursor, cline, gemini, codex × deployed + catalog) switched from manual `extractKeywords → searchBrain → formatResults` chain to `core.recall()` with prompt-type detection, smart keyword extraction, relation expansion, and token budgeting (TASK_TOKEN_CAP=1500)
- **SubagentStart hook** — `kg-auto-recall.cjs` added to SubagentStart event in `.claude/settings.json`, giving subagents automatic KG context
- **PreCompact hook** — `kg-pre-compact.cjs` (new file) fires before context compaction, reminds agents to save unsaved knowledge to KG
- **MCP tool annotations** — `readOnlyHint: true` and `idempotentHint: true` on all 30 tools across 9 modules (memory, codegraph, intelligence, unified-search, session, skills, skill-search, deep-scan, setup) for safe agent parallelism via 5-arg `server.tool()` form
- **YAML list frontmatter** — `parseFrontmatter()` in `skill-adapters.mjs` now supports `key:\n  - item` syntax, returning `string[]`
- **Command context routing** — All 14 command files tagged with `context: fork` (8 commands) or `context: inline` (6 commands) for agent execution strategy
- **Skill paths** — Added `paths:` YAML lists to `auto-memory` and `biz-guard` catalog skills
- **Publish preflight** — `scripts/publish-preflight.mjs` with 8 automated checks (git clean, version/changelog sync, README match, unit tests, e2e tests, secrets scan, npm pack dry-run, Node version); wired as `prepublishOnly` in package.json
- **New npm scripts** — `test:e2e`, `test:all`, `publish:dry` for dev workflow
- **CodeGraph Viewer** (`viewer/code-viewer.html`) — Standalone visualization tool for code intelligence (2118 LOC, Sigma.js v2.4.0 + Graphology v0.25.4). Features: force-directed graph rendering, file tree sidebar with symbol hierarchy, search/filter, impact analysis via 3-hop BFS (upstream/downstream/both), process flow detection via DFS, business rule overlay (code ↔ KG RULE entities), export (JSON/SVG/PNG), keyboard shortcuts. Zero dependencies beyond CDN scripts.

### Fixed
- **Agent-specific recall hooks using old manual chain** — 4 agent variants (cursor, cline, gemini, codex) in `.claude/hooks/`, `catalog/hooks/`, `.cursor/hooks/`, `.gemini/hooks/` were still using old pattern; all 10 files updated to `core.recall()`
- **`skill-index.mjs` parsePaths() crash on array** — After `parseFrontmatter()` upgrade returned arrays for YAML lists, `parsePaths()` called `.split()` on arrays; added `Array.isArray()` guard
- **MCP tool count test** — Description said "28" while assertion checked 30; fixed to match

### Changed
- **Test count** — 103 unit/integration + 16 e2e passing (was 100 + 9)
- **MCP tool count** — 30 tools (was 28; +deep_scan, +setup modules added prior)

---

## [6.1.0] — 2026-04-15

### Added
- **Unified Impact Bridge** — `hermit_impact` returns business rules at risk alongside code blast radius (3-layer: CodeGraph + KG rules + BUSINESS.md chains)
- **`biz-linker.mjs`** — Deterministic file-path join between blast radius and KG RULE/FLOW entities
- **`project-learner.mjs`** — Deterministic project scanner: reads package.json, tsconfig, README, etc. Writes BIZ + TECH entities to brain on setup
- **Auto-fill BUSINESS.md** — `hermit setup` generates BUSINESS.md pre-filled with auto-detected Domain + Tech Stack
- **Monorepo workspace scanning** — Auto-learn detects frameworks/tools in workspace packages (Yarn, npm, pnpm)
- **5-second timeout guard** on auto-update hook

### Fixed
- Hook `lib/` subdirectory copies recursively during setup (MODULE_NOT_FOUND fix)
- Yarn Berry `workspaces` object format no longer crashes project scanner
- `ensureIndex` race condition — concurrent MCP calls deduplicated via promise map
- Scoped npm package names (`@org/pkg`) no longer produce malformed entity names
- `resolveDataDir` resolves relative `cwd` to absolute before path operations
- Dead `embeddings` param removed from `hermit_index` schema
- Removed `.claude-settings.json` from npm `files` array (privacy)
- Auto-update hook project name uses PascalCase (consistent with KG naming)

---

## [6.0.1] — 2026-04-15

### Fixed
- **indexer.mjs** — Command injection fix: `execSync` → `execFileSync` for git commands (CRITICAL)
- **merge-brain-jsonl.mjs** — Serialize object observations before sorting in merge fingerprint (CRITICAL)
- **brain-io.mjs** — Invalidate read cache before write operations (prevents stale reads)
- **code-io.mjs** — Added `invalidateCache()` export for external reindex coordination
- **indexer.mjs** — Null sentinel for force-push fallback (prevents silent failures)
- **file-lock.mjs** — Guard against non-object lock format (prevents parse errors)

### Changed
- **Documentation** — All docs updated from v5 to v6.0.0; deleted 6 stale GitNexus docs + root viz HTML (-2473 LOC)
- **Rules files** — Updated AGENTS.md, .clinerules, .windsurfrules, templates/hermit-rules.md: GitNexus→ast-grep references
- **README** — Fixed hook count (7→5 actual agents), fixed `hermit hooks export` CLI syntax

---

## [6.0.0] — 2026-04-15

### Breaking Changes
- **Removed GitNexus dependency** — All code intelligence is now built-in via ast-grep. Deleted `gitnexus-runner.mjs` (296 LOC subprocess manager replaced by in-process analysis)
- **`@ast-grep/napi`** added as bundled dependency (napi-rs prebuilt binaries, no node-gyp)
- **Deleted 6 stale GitNexus docs** from `docs/` directory

### Added
- **10 code-intel modules** in `scripts/lib/code-intel/`:
  - `parser.mjs` — ast-grep wrapper (JS/TS/TSX built-in, Python via optional `@ast-grep/lang-python`)
  - `extractor.mjs` — Symbol & relation extraction orchestrator
  - `extractor-js.mjs` — JS/TS-specific extractor
  - `extractor-py.mjs` — Python-specific extractor
  - `graph.mjs` — In-memory CodeGraph data structure
  - `code-io.mjs` — JSONL persistence with mtime caching
  - `impact.mjs` — 3-hop BFS blast radius analysis (d=1 WILL_BREAK, d=2 LIKELY_AFFECTED, d=3 MAY_NEED_TESTING)
  - `indexer.mjs` — Full + incremental indexing via git diff
  - `process-detector.mjs` — DFS-based execution flow detection
  - `index.mjs` — Public API facade
- **Auto-indexing** — CodeGraph tools auto-index on first query if no index exists
- **Incremental indexing** — Only re-parses files changed since last git commit
- **Process detection** — Discovers execution flows via DFS call chain tracing
- **Unified search** — `hermit_unified_search` merges KG entities + code symbols in one query
- **`data/code-symbols.jsonl`** — Auto-generated code intelligence index

### Improved
- **100 tests passing** in test-v4.mjs (up from 98) + 9 e2e code-intel tests
- **MCP server** boots with all 28 tools, zero external dependencies
- **Performance** — Full index ~2s (85 files), queries <10ms, impact <20ms, process detection ~50ms

### Changed
- **Dependencies** — Added `@ast-grep/napi ^0.42.1`, optional `@ast-grep/lang-python ^0.0.6`; updated `zod` to `^4.3.6`

---

## [5.1.1] — 2026-04-15

### Fixed
- **brain-io.mjs** — Atomic writes via temp file + `renameSync` (prevents data loss on crash); path normalization with `resolve()` for cache consistency
- **entity-extractor.cjs** — `appendToBrain` now acquires advisory `.lock` file (prevents corruption from concurrent MCP server + hook writes); `filterExisting` skips brain read when no entities extracted
- **gitnexus-runner.mjs** — Bridge failure uses 60s cooldown instead of permanent disable (recovers from transient errors); `process.on('exit')` handler kills orphan bridge subprocess
- **memory-module.mjs** — `hermit_create_entities` warns on entityType merge conflicts (existing type preserved); `hermit_create_relations` validates from/to entities exist before creating
- **codegraph-module.mjs** — `hermit_detect_changes` invalidates TTL cache (handles external reindex)
- **recall-core.cjs** — `checkEntityScope` accepts pre-built scopes cache; `searchBrain` builds scopes once (was O(N*M) file reads per search)
- **skill-index.mjs** — `buildSkillIndex` logs non-ENOENT errors instead of silently swallowing all exceptions
- **hook-export.mjs** — `exportHook` creates timestamped `.bak` backup before overwriting existing hooks

---

## [5.1.0] — 2026-04-15

### Added
- **Zero-config multi-agent setup** — `hermit setup` now configures ALL agents (Claude, Cursor, Gemini, Windsurf, Cline, Codex, OpenCode) in one command. No `--agent` flag needed.
- **Windsurf agent support** — MCP config, rules file with idempotent `<!-- hermit:rules -->` markers
- **OpenCode agent support** — MCP config, rules file (AGENTS.md merge-single), hooks
- **Rules file row** in agent support table — tracks per-agent rules/instructions file

### Fixed
- **gitnexus-runner.mjs** — Bridge init race condition (concurrent `ensureBridge()` calls now share a single promise); `callInProcess` passes `cwd` to backend; `sanitizeArg` regex no longer blocks parentheses; bridge close/error handlers drain pending responses
- **codegraph-module.mjs** — `isIndexError` narrowed (removed broad `exited with code 1` match); `hermit_detect_changes` returns informational message on stale index instead of silently auto-reindexing
- **setup-project.mjs** — `copyBusinessTemplate` accepts agent param (was null in `--all` mode); Windsurf rules use idempotent markers (prevents duplication on re-run); `resolveSkillSelection` called once (was called twice); JSONC-safe JSON.parse for IDE config files; removed dead `configureClineInstructions`/`configureCodexInstructions`; removed duplicate Cursor MCP config in `--all` mode
- **hook-export.mjs** — `HOOK_AGENT_SUFFIXES` derived from AGENTS map (auto-includes new agents); `writeCursorMcpConfig` captures `existed` before file write (was always reporting 'created')

### Changed
- **Agents** — 7 supported (was 5): added Windsurf + OpenCode
- **README** — Updated agent count, support table, setup commands, config paths
- **package.json description** — Includes all 7 agents

---

## [5.0.0] — 2026-04-14 (v5 Sprint 1 + Sprint 2 + Sprint 3 + Sprint 4)

### Added

#### Skill Search (Phase 0 + Phase 1)
- `scripts/lib/skill-index.mjs` — unified skill metadata index from catalog + project skills, lazy singleton cache
- `scripts/lib/skill-search-module.mjs` — `hermit_skill_search` MCP tool with weighted keyword scoring (name 5x, tags 3x, desc 1x)
- 11 new tests: buildSkillIndex, caching, invalidation, searchSkills scoring/filtering/sorting

#### Token-Aware KG Injection (Phase 2)
- `estimateChars(results, level)` — char estimation at compact/standard/full detail levels
- `selectDetailLevel(results, capOverride)` — auto-selects detail level vs token budget (default 3000 tokens via `HERMIT_RECALL_TOKEN_CAP`)
- `formatResults()` now accepts optional `detailLevel` parameter; auto-detects if omitted
- Progressive detail: compact (names only), standard (name + 1 obs), full (name + 3 obs)
- Stderr debug logging when detail level is downgraded

#### KG Context Forwarding (Phase 5)
- `detectPromptType(prompt)` — classifies task (subagent) vs conversational (user) prompts; requires 2+ task signals
- `extractTaskKeywords(prompt)` — specialized extraction for task payloads: file paths, entity refs, backtick terms, capped standard keywords
- `expandRelations(results, brainPath)` — depth-1 relation traversal, max 3 extra entities
- `recall(prompt)` — high-level orchestrator: prompt detection → smart keyword extraction → search → expansion → token-budgeted format
- Task prompts get lower token cap (1500) and depth-1 relation expansion
- 16 new tests: token estimation, detail level selection, prompt detection, keyword extraction, relation expansion, recall orchestration

#### Smart Skill Activation (Phase 3)
- `paths:` frontmatter field for conditional skill activation in Claude Code
- Added paths to 2 catalog skills (api-design, db-migrations) and 15 project skills
- Claude export preserves full frontmatter (paths, tags, complexity, requires-tools)
- Non-Claude exports receive body only — frontmatter naturally excluded
- Fixed `skill-export.mjs` to pass full content to Claude transform (was stripping frontmatter)

#### OpenCode Export (Phase 6)
- `opencode` added as 6th agent to AGENTS map in skill-adapters.mjs
- Skills: per-file to `.opencode/skills/{name}/SKILL.md`
- Commands: merge-single to `AGENTS.md`
- Hooks: per-file to `.opencode/hooks/`
- Strip options: preserveDelegation + preserveHooks (same as Cursor)
- All 6 existing MCP export tools auto-include opencode via dynamic AGENT_NAMES

#### Post-Response KG Update (Phase 4)
- `catalog/hooks/lib/entity-extractor.cjs` — regex-based entity extraction from assistant messages
- 6 regex extractors: explicit backtick refs, tech decisions, error patterns, PascalCase, ALL_CAPS, file paths
- Classification pipeline: maps extractions to KG entity names + types (TIER:SCOPE:LABEL)
- Frequency filter: noisy patterns (PascalCase/ALL_CAPS) require 3+ mentions
- Deduplication: skips entities already in brain.jsonl (case-insensitive name match)
- Auto-confidence: all entities written with `[0.5|date]` prefix (unverified)
- Rate limit: max 10 entities per session
- Kill switch: `HERMIT_AUTO_UPDATE=false` disables entirely
- `catalog/hooks/kg-auto-update.cjs` — Claude Code Stop hook
- Agent adapters: cursor, gemini, cline, codex variants
- 20 new tests: individual extractors, classification, full pipeline, frequency filter, dedup, appendToBrain

#### Richer Frontmatter (Phase 3 + 6)
- `tags:` — comma-separated keywords for skill search discovery
- `complexity:` — simple/moderate/complex model routing hint
- `requires-tools:` — bash/file-ops/mcp/browser agent compat hint
- Added to all 6 catalog skills + 15 domain project skills

### Changed
- **Agents** — 6 export targets (was 5): added opencode
- **MCP tool count** — 28 tools + 1 resource (was 27+1)
- **Test count** — 98 passing (was 51)

---

## [4.3.0] — 2026-04-13

### Added

#### Cross-Agent Command Export (P1)
- `discoverCommands()` + `exportCommand()` + `exportAllCommands()` in skill-export.mjs
- Commands use distinct `hermit:cmd:{name}` section markers (independent from skill markers)
- 14 commands now exportable to all 4 agents (Claude per-file, Cursor MDC, Gemini/Codex merge-single)

#### Auto-Recall Hook Adapters (P2)
- `catalog/hooks/lib/recall-core.cjs` — extracted shared search logic from kg-auto-recall.cjs
- `catalog/hooks/kg-auto-recall-cursor.cjs` — Cursor adapter (stdout text injection)
- `catalog/hooks/kg-auto-recall-gemini.cjs` — Gemini CLI adapter (JSON `{context}`)
- `catalog/hooks/kg-auto-recall-cline.cjs` — Cline adapter (JSON `{contextModification}`)
- Refactored `kg-auto-recall.cjs` to thin adapter (38 LOC, was 364)

#### Auto-Save Hook Adapters (P3)
- `catalog/hooks/lib/session-core.cjs` — shared session lifecycle logic
- `catalog/hooks/session-hook-cursor.cjs` — Cursor session adapter
- `catalog/hooks/session-hook-gemini.cjs` — Gemini CLI session adapter
- `catalog/hooks/session-hook-cline.cjs` — Cline session adapter

#### Hook Export System (P4)
- `scripts/lib/hook-export.mjs` — hook discovery, agent parsing, file copying + lib/ co-location
- `parseHookName()` — extracts purpose + agent from `{purpose}-{agent}.cjs` convention
- `exportHook()` / `exportAllHooks()` — copies hooks + lib/ deps to agent-specific locations
- `catalog/hooks/HOOKS-README.md` — registration guide for Claude, Cursor, Gemini CLI, Cline

#### 4 New MCP Tools
- `hermit_command_list` — list available commands with per-agent export strategy info
- `hermit_command_export` — export command(s) to target agent
- `hermit_hook_list` — list available hooks grouped by purpose, filtered by agent
- `hermit_hook_export` — export hook(s) + lib/ dependencies to target agent

### Changed

- **Unified AGENTS config** — `skill-adapters.mjs` now has nested `skills`, `commands`, `hooks` keys per agent (was flat skill-only)
- **skills-module.mjs** — 6 tools registered (was 2)
- **skills-manager.mjs** — `export` subcommand supports `--commands` and `--hooks` flags; `--all` exports skills+commands+hooks
- **MCP tool count** — 27 tools + 1 resource (was 23+1)

### Testing

- **51/51 tests passing** (was 44): +6 command export tests, +7 hook export tests, +2 MCP integration tests, MCP tool count updated
- Command export: discoverCommands, per-file, merge-single cmd markers, exportAllCommands, marker independence
- Hook export: parseHookName, discoverHooks, copyLibDir, exportHook+lib, exportAllHooks agent filtering

---

## [4.2.1] — 2026-04-13

### Fixed

- Session module missing from all documentation (README, system-architecture, codebase-summary)
- Module count in docs now correctly shows 6 modules / 23 tools + 1 resource

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

*Last updated: 2026-04-17 | Current version: 6.3.1*
