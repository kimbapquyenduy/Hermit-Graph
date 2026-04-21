# Project Changelog — Hermit Graph

All notable changes to Hermit Graph are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en.1.1.0/).

---

## [6.6.2] — 2026-04-21

### Added
- **PreToolUse hook now computes impact counts inline** — `kg-pre-edit-impact.cjs` used to just list symbols and say "call hermit_impact". Now it loads the relations from `code-symbols.jsonl`, runs a 3-hop upstream BFS per symbol, and embeds `d=1:N d=2:N d=3:N risk:LEVEL` directly in the stderr nudge. AI reads the risk numbers from the warning — no follow-up `hermit_impact` tool call needed for basic triage
- **Symbols sorted by fan-in descending** in the nudge — highest-risk symbols surface first regardless of where they appear in the file
- **Conditional drill-down tip** — when d1>0 on any symbol, tip says "call hermit_impact for full caller list"; when all d1=0, tip directs to framework-binding grep (for controllers, handlers, etc.)

### Fixed
- **Relation kind case-mismatch** — hook was filtering relations by `kind === 'calls'` but the indexer writes `kind: 'CALLS'` (uppercase). Every symbol reported 0 callers. Now matches case-insensitively

### Verified (WebCash 420 files / Factory 4960 files)
- WebCash `UserController.js` → `getUser d=1:317 risk:HIGH` (was 0 before the case fix)
- WebCash `AES.js` → `AES.encrypt d=1:27 risk:HIGH`, `AES.createSHA256 d=1:5 d=2:280 d=3:91`
- Factory `factory-com-proto/user.ts` → 4 symbols, all d=1:0 (expected — proto/gRPC framework dispatch outside AST)
- Factory `auth.service.ts` → 3 NestJS service methods, d=1:0 (framework-invoked)

### User-facing effect
Before v6.6.2, the nudge was: *"12 symbols in this file. Call hermit_impact for details."*
After v6.6.2, the nudge is: *"12 symbols. AES.encrypt d=1:27 HIGH. AES.createSHA256 d=1:5 d=2:280 d=3:91. AES.verify d=1:3 d=2:2 MEDIUM. ..."*

AI sees the risk picture directly. For high-fan-in symbols it knows to be careful; for zero-caller ones it knows to grep route config. Zero extra MCP calls unless AI wants the specific caller file list.

---

## [6.6.1] — 2026-04-21

### Added — zero-config auto-setup for pre-edit impact enforcement

Previously, v6.6.0 shipped the PreToolUse hook + `code-guard` skill but users had to manually wire them in `.claude/settings.json`. v6.6.1 makes `hermit setup` auto-configure both, so a fresh install is ready to use without touching any config file.

- **Auto-register `kg-pre-edit-impact` PreToolUse hook** — `hermit setup` now appends the hook entry to `.claude/settings.json` with matcher `Edit|Write|MultiEdit`. Idempotent: re-running setup doesn't create duplicates. Opt-out via `hermit setup --skip-impact-guards`
- **Fallback settings.json creation** — previously if template `.claude-settings.json` was missing AND project had no `.claude/settings.json`, hook registration silently failed. Now creates a minimal `{ "mcpServers": {}, "hooks": {} }` file as baseline for hook registration
- **`code-guard` skill included in default skill set** — already was by default since `resolveSkillSelection()` starts from `[...allSkills]`; this release verified end-to-end installation via `hermit skills add --all` equivalent flow
- **`HERMIT_USER_CWD` env honored in `setup-project.mjs`** — previously setup's `projectRoot` defaulted to `process.cwd()`, which was forced to hermit-graph root by brain-cli's `fork({ cwd: ROOT })`. This meant setup targeted the wrong project. Now uses `HERMIT_USER_CWD` (set by brain-cli) for the caller's original cwd

### Verified
- Fresh test project `d:/tmp/hermit-test-project` → `hermit setup` creates `.claude/settings.json` with both hooks registered + `code-guard` skill copied + CLAUDE.md template
- Idempotent: re-running setup finds 1 entry each (no duplicates)
- Target cwd correct: setup output shows `Project: D:\tmp\hermit-test-project`, not hermit-graph

### User-facing effect
```bash
# Before v6.6.1: multi-step manual config
hermit setup
# then edit ~/.claude/settings.json manually to add PreToolUse hook
# then hermit skills add code-guard

# After v6.6.1: one command
hermit setup
# Done. Hooks registered, skill installed, CLAUDE.md created.
```

---

## [6.6.0] — 2026-04-21

Pre-edit impact enforcement — remaining 3 phases from `plans/260421-1230-pre-edit-impact-enforcement/`. v6.5.0-v6.5.1 shipped Phase 1 (embedded Impact Preview). This release ships Phases 2, 3, 4 together after full e2e on WebCash.

### Added — Phase 2: `code-guard` skill
- New catalog skill `catalog/skills/code-guard/SKILL.md` — activates on edit/refactor/rename keywords (VI + EN). Prompts the AI to call `hermit_impact` before editing exported or framework-bound symbols. Distributed via `hermit skills add code-guard` to all 6 supported agents (Claude Code, Cursor, Gemini CLI, Codex, Cline, Windsurf). Mirrors proven `biz-guard` pattern.

### Added — Phase 3: `kg-pre-edit-impact.cjs` PreToolUse hook
- New hook `catalog/hooks/kg-pre-edit-impact.cjs` — soft nudge on Edit/Write/MultiEdit. Reads the target file's symbols from the CodeGraph index, emits stderr warning listing up to 5 exported/framework-bound/class-method symbols with file:line. Never blocks the edit.
- **Soft-warn design** — exit code always 0. Claude Code surfaces stderr to the AI, so warning becomes context. No hard-block hostile UX.
- **Env switches** — `HERMIT_PRE_EDIT_QUIET=1` to silence. Auto-skips non-source files, non-target tools, files outside project root, and projects without an index.
- **Heuristic** — includes exported symbols, framework-bound (middleware/command/job/controller), and all class methods (CommonJS extractors often miss `module.exports = Class`).

### Added — Phase 4: `hermit check-edit` CLI
- New command `hermit check-edit <file>... [--verbose] [--format=json] [--cwd=PATH]` — terminal-based pre-edit impact check for IDE workflows that bypass the AI entirely. Lists every exported/framework-bound symbol in the target file with transitive caller counts sorted by d=1.
- Pre-commit hook integration example: `git diff --cached --name-only | xargs hermit check-edit`
- JSON output mode (`--format=json`) for CI pipelines.
- Auto-indexes if `data/code-symbols.jsonl` missing.

### Infra
- `brain-cli.mjs` now exposes `HERMIT_USER_CWD` env to child scripts (preserves caller's cwd through fork)
- `package.json` files whitelist now includes `scripts/check-edit-cli.mjs`
- `catalog/` whitelist already covered the new hook + skill

### Verified (WebCash via MCP stdio)
- `hermit check-edit SHINWOO/gsf20/app/Controllers/Http/UserController.js` — 24 total symbols, 23 with refactor risk, `UserController.getUser` correctly flagged as HIGH (d=1:317)
- `--format=json` produces valid jq-parseable output
- PreToolUse hook — nudge fires on controller file edit, silent on README.md, silent in `HERMIT_PRE_EDIT_QUIET=1` mode, silent on Bash tool, silent on file outside project root
- `code-guard` skill appears in `hermit skills` list, can be installed via `hermit skills add code-guard`

### Complete story
All 4 phases shipped. Covers:
1. AI-discovery path (v6.5.0) — risk shown inline in `hermit_context`/`hermit_query`
2. AI-activation path (v6.6.0 skill) — keyword-triggered reminder to call `hermit_impact`
3. AI-fallthrough path (v6.6.0 hook) — soft nudge when AI goes straight to Edit
4. IDE-bypass path (v6.6.0 CLI) — terminal check for direct-file-editing workflows

---

## [6.5.1] — 2026-04-21

### Fixed
- **Impact Preview drill-down prompt only fires when `d1 > 0`** — previously, the preview footer *"Call `hermit_impact(...)` for full caller list + business rules"* appeared even on symbols with 0 direct callers, where a follow-up hermit_impact call would return the identical zero-count result. Bug caught by v6.5.0 adoption subagent: *"When d1=0, that footer is redundant noise"*
- Impact Preview still fires for framework-bound symbols with 0 callers (correct — the framework-binding hint directs user to grep config, not to call hermit_impact again)

### Verified (WebCash)
- `hermit_context("logIn")` (d1=0, framework-bound) → Preview YES, drill-down prompt NO ✓
- `hermit_context("AES.verify")` (d1>0) → Preview YES, drill-down prompt YES ✓

---

## [6.5.0] — 2026-04-21

### Added
- **Embedded Impact Preview in `hermit_context` responses** — d=1/d=2/d=3 caller counts + risk level now appear inline in every context response (when signal exists: d1>0 OR framework-bound). AI sees refactor risk in the normal discovery flow without a second tool call
- **Inline `[d=1:N]` tag in `hermit_query` results** — exported symbols and class methods now show their direct-caller count in the symbol list, nudging AI toward deeper investigation on high-fan-in symbols
- **`impactCounts()` public API** — fast count-only BFS (<5ms typical) for embedding risk info in any tool response without the full caller/callee lists
- **Extended framework-binding heuristic** — controller methods (class name ends with `Controller`, OR file path matches `/controllers?/`) now flagged as framework-invoked. Previously only middleware/command/job dirs. Catches Adonis/Laravel/Rails route dispatch patterns

### Why this release
Real benchmark on WebCash exposed the gap: `hermit_impact` is probabilistic — AI sometimes calls it before edits, sometimes not. When the decision to edit comes AFTER discovery, AI has moved on and doesn't remember. Fix: surface risk info DURING discovery, embedded in the response AI is already reading.

### Verified (WebCash e2e via MCP stdio)
- `hermit_context("logIn")` — controller method, 0 callers → Impact Preview fires (framework-bound path)
- `hermit_context("b64_md5")` — internal helper → no preview (correct — noise reduction)
- `hermit_query("authentication login")` — 4 results tagged with `[exported, d=1:N]`
- `hermit_impact("verifyOTPToken")` — risk + d=1 regression intact
- `hermit_impact("User.handle")` — v6.4.2 framework hint regression intact

### Plan
Ship Phase 1 only. Phases 2-4 (skill, pre-edit hook, `hermit check-edit` CLI) deferred to measure adoption signal before adding more enforcement layers. See `plans/260421-1230-pre-edit-impact-enforcement/`

---

## [6.4.2] — 2026-04-21

### Added
- **Framework-binding heuristic hint** — `hermit_context` and `hermit_impact` now detect likely framework-invoked symbols (middleware, commands, jobs, handlers, listeners) and append a hint line when AST reports 0 callers. Prevents misleadingly LOW risk scores on middleware `handle` methods that are actually string-bound by the framework (e.g. `.middleware("user")`, `Route::group`, `Bus::dispatch`). Heuristic requires ALL three signals:
  - File path matches `/middleware|commands?|jobs?|handlers?|listeners?|tasks?|observers?|events?|hooks?|subscribers?/`
  - Symbol name is a convention method (`handle`, `run`, `execute`, `process`, `dispatch`, `invoke`, `perform`, `fire`, `trigger`, `exec`, `call`, `__invoke`)
  - 0 AST callers

### Verified (WebCash)
- `impact("User.handle")` — now emits hint (was LOW risk silent before) ✓
- `impact("NuxtBuild.handle")` — command class, emits hint ✓
- `impact("CallAPIProcedureNoAuthen")` — regular method with callees, NO hint (no false positive) ✓
- 6 unit-test scenarios all pass

---

## [6.4.1] — 2026-04-21

### Fixed
- **`hermit_context` and `hermit_impact` no longer silently fail on common method names** — when a name is ambiguous (e.g. `handle` matches 3 classes), the tool now returns a disambiguation list showing `ClassName.methodName` + file:line for each candidate, instead of returning "Symbol not found"
- **Supports `ClassName.methodName` resolution** — pass `hermit_context({name: "User.handle"})` to resolve scoped methods uniquely

### Known limitations (deferred)
- **No route→middleware→handler graph** (the "which routes are unprotected" question) — requires framework-specific parsers (AdonisJS Route.X, Express app.use, Next.js file-based routing). Design target: plugin architecture in v6.5.0
- **No dotted-accessor caller query** (e.g. "who calls `auth.getUser()`?") — ast-grep extractor does not track object identity. Would require TypeScript LSP-level scope analysis. Workaround: use Grep for now

---

## [6.4.0] — 2026-04-21

### Added
- **Real semantic code search** — `hermit_query` now uses embedding-based retrieval, not just substring matching. Closes the long-standing gap where the description claimed "semantic" but the implementation was `Array.filter(name.includes(query))`
- **New module `scripts/lib/code-intel/code-semantic.mjs`** — embeds each symbol as `<name> <kind> <file-stem> called-by:<callers> calls:<callees>` using the existing `all-MiniLM-L6-v2` model (384-dim). Cached to `<project>/data/code-embeddings.json`
- **Hybrid rank** — combines vector similarity (0.7 weight) with tokenized keyword overlap (0.3 weight). Pure keyword fallback when the model is unavailable
- **Lazy build** — first query in a project builds the index (~15-30s for 3-5k symbols), subsequent queries are ~300ms. Incremental: only re-embeds new symbols, keeps existing vectors
- **`hermit_unified_search` also upgraded** — code side now uses semantic matching, producing better-ranked combined results

### Changed
- **`hermit_query` description now accurate** — no longer overclaims. Clear about the new capability: *"Semantic code search — finds symbols by CONCEPT, not literal substring. Hybrid vector + keyword rank. First call auto-builds embedding index (~30-60s for medium repo), cached thereafter."*
- **New public API: `codeIntel.semanticQuery(query, dataDir, opts)`** — async, returns scored symbols. Old `codeIntel.query()` kept for backward compat

### Verified (real project, WebCash — 3909 symbols)
| Query | v6.3.x hits | v6.4.0 hits | First-call latency | Cached latency |
|---|---|---|---|---|
| "authentication middleware" | **0** | 5 (User, state, verify…) | 17.5s (index build) | 280ms |
| "validate user token" | **0** | 5 (getSSOToken, checkToken, verify2FA…) | cached | 319ms |
| "database connection" | — | 5 (DBService, MySQLService…) | cached | 279ms |
| "error handling" | — | 5 (ErrorHandling@1.0, ConsoleLogError…) | cached | 295ms |

Notes:
- Pure-vector hits (keyword score 0.0) like `DBService` for "database connection" prove embeddings capture concept similarity beyond substring matching
- 31MB cache for 3909 symbols (~8KB per vector as JSON). Binary format optimization deferred

---

## [6.3.10] — 2026-04-21

### Fixed
- **Auto-reindex triggered full reindex on every query for non-git projects** — v6.3.8 gated the "index exists" check on `graph.meta.commit`, which is `null` for projects without git history. Non-git projects therefore hit the "no index yet" branch on every call, causing 20-30s latency per `hermit_query`/`context`/`impact`. Fixed by gating on `symbols.size > 0` instead
- **Stale-check now skips non-git projects entirely** — they always report `stale=true, changed=[]`, so running the check added noise with no benefit

### Verified (real project, WebCash)
| Tool | v6.3.8 latency | v6.3.10 latency | Speedup |
|---|---|---|---|
| `hermit_query` | 26,492ms | 55ms | **481x** |
| `hermit_context` | 30,896ms | 18ms | **1716x** |
| `hermit_impact` | 29,309ms | 26ms | **1127x** |
| `hermit_detect_changes` | 3,871ms | 16ms | **241x** |

---

## [6.3.9] — 2026-04-21

### Changed
- **Tool descriptions rewritten for AI adoption** — LLMs pick tools by scanning descriptions. The prior passive phrasings ("Blast radius analysis", "Keyword search") produced low pickup vs Grep. Rewrote 12 tool descriptions with action verbs, uniqueness claims vs Grep, and usage triggers. Key changes:
  - `hermit_impact` — now opens with "REQUIRED before editing any exported function/class/method" + explicit "Grep cannot find transitive breakage"
  - `hermit_context` — emphasizes "ALL callers and callees in one shot" vs grepping by name
  - `hermit_query` — positioned for "fuzzy/intent-based search when exact names unknown"
  - `hermit_unified_search` — positioned as "FIRST action" for unfamiliar areas, replaces "3-5 Grep queries"
  - `hermit_search_nodes` — prompts use "BEFORE asking clarifying questions — you may have answered this before"
  - `hermit_create_entities` — closes with "THIS is how you remember things next session"
  - `hermit_create_relations`, `hermit_add_observations`, `hermit_open_nodes`, `hermit_get_related`, `hermit_semantic_search`, `hermit_detect_changes`, `hermit_index`, `hermit_health` also strengthened
- **Zero behavior change** — tool schemas, inputs, outputs all identical. Only the LLM-facing descriptions changed

### Known limitation
- Text descriptions alone don't force adoption — they shift probability. For hard enforcement, a future `kg-pre-edit-impact.cjs` PreToolUse hook would block Edit/Write without a prior `hermit_impact` call. Not in this release

---

## [6.3.8] — 2026-04-21

### Added
- **CodeGraph auto-reindex on stale** — every `hermit_query`/`hermit_context`/`hermit_impact` call now runs an incremental reindex if git HEAD has moved since last index. Incremental only re-parses changed files (<100ms when nothing changed). Projects with no git history safely skip the check. Previously, queries returned results from stale graphs until user manually ran `hermit_index`

### Verified
- Tested indexing on external WebCash project (420 files, 3909 symbols, 10354 relations) — full index ~44s, subsequent queries instant
- Non-git projects handled correctly (stale-check safely skips auto-reindex when `changed=[]`)

---

## [6.3.7] — 2026-04-21

### Fixed
- **`hermit view` now uses current working directory** — previously hardcoded to the hermit-graph package root, so `hermit view --code` always showed hermit-graph's own CodeGraph regardless of where the user ran the command. Now resolves `data/code-symbols.jsonl` and `data/brain.jsonl` relative to `process.cwd()`
- **Empty-state handling** — viewer opens with no data and a helpful message when the current project has no indexed CodeGraph or brain file, instead of erroring out. Users can still load a file via the UI

---

## [6.3.6] — 2026-04-20

### Fixed
- **CodeGraph auto-scopes to current project** — tools now honor `CLAUDE_PROJECT_DIR` (set by Claude Code) and `HERMIT_PROJECT_CWD` env vars as the default target, eliminating the need to pass `cwd` on every call. Previously, globally-registered MCP servers stayed pinned to their launch cwd (usually hermit-graph's own folder), causing queries to return results from the wrong project
- **Index path consistency** — `hermit_detect_changes` and `hermit_index` now use the resolved project cwd instead of `process.cwd()`, so the index always lives at `<active-project>/data/code-symbols.jsonl`
- **`hermit_index` cwd is optional** — was required, now falls back to env/process cwd like the other CodeGraph tools

### Changed
- **`searchCode` in unified-search** — no longer silently returns empty when `cwd` is omitted; honors the env fallback chain

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
