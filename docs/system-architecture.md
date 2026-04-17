# System Architecture — hermit-graph

## Overview

hermit-graph is a distributed knowledge graph system for AI-assisted development. It captures, organizes, and retrieves project intelligence (architecture decisions, code patterns, business rules, incidents) across development sessions. **v6.0.0:** Unified MCP server with 28 tools + 1 resource across 7 modules. Multi-agent hooks (auto-recall + auto-update) across 7 agents (Claude, Cursor, Gemini, Windsurf, Cline, Codex, OpenCode).

**Core technology:** JSONL-based knowledge graph + MCP server v1.29.0 + semantic embeddings + built-in code intelligence (ast-grep)

---

## Architecture Layers

### 1. Data Layer

#### Brain JSONL (Single Source of Truth)
- **File:** `data/brain.jsonl`
- **Format:** Newline-delimited JSON (entities + relations)
- **Entity format:** `{type: 'entity', name, entityType, observations: [...], _branch?, _archived?, _archivedAt?, _history?[]}`
- **Relation format:** `{type: 'relation', from, to, relationType}`
- **Entity types:** 13 types (biz-domain, biz-rule, biz-flow, biz-entity, pattern-code, pattern-arch, pattern-integration, tech-stack, tech-config, tech-person, tech-decision, incident-bug, incident-gotcha)
- **Access control:** File-level locking (see File Lock Service below)
- **Merge strategy:** Custom git merge driver (`merge-brain-jsonl.mjs`) for branch-aware conflict resolution

#### Embedding Index
- **File:** `data/brain-embeddings.json`
- **Purpose:** Pre-computed semantic embeddings for all observations
- **Model:** Xenova/all-MiniLM-L6-v2 (384-dim, ONNX format)
- **Rebuild:** `npm run build:index` or `brain index`
- **Purpose:** Hybrid search acceleration (semantic + keyword)

#### Code Intelligence Data
- **File:** `data/code-symbols.jsonl` (auto-generated, gitignored)
- **Contains:** Function/class/method symbols with relations (calls, imports, exports)
- **Auto-indexes:** On first query via `hermit_query` or `hermit_index`; incremental updates via git diff
- **Format:** JSONL with mtime caching for fast incremental rebuilds

---

### 2. Service Layer

#### Embedding Service (`scripts/lib/embedding-service.mjs`)
- **Model:** Hugging Face all-MiniLM-L6-v2 (ONNX)
- **Inference:** Pure JavaScript/WASM (no Python dependency)
- **Singleton:** Loads model once, reuses across API calls
- **Graceful fallback:** Returns null if model unavailable (semantic search disabled, keyword-only)
- **Exports:**
  - `embed(text)` → Float32Array[384]
  - `embedBatch(texts)` → Float32Array[n][384]
  - `isAvailable()` → boolean

#### Semantic Search (`scripts/lib/semantic-search.mjs`)
- **Hybrid scoring:** 0.7 * cosine_similarity + 0.3 * keyword_relevance
- **Index source:** Pre-computed embeddings from `brain-embeddings.json`
- **Query:** Text search with optional filters (entityType, dateRange)
- **Ranking:** Returns results sorted by hybrid score
- **Fallback:** Keyword-only if embeddings unavailable

#### File Lock Service (`scripts/lib/file-lock.mjs`)
- **Purpose:** Cross-process synchronization for concurrent brain.jsonl access
- **Implementation:** POSIX fcntl / Windows LockFileEx
- **Exports:**
  - `acquireLock(filepath)` → Promise<LockHandle>
  - `releaseLock(handle)` → Promise<void>
- **Timeout:** Configurable (default 5s)
- **Use case:** Multiple MCP clients, CLI tools, web viewers accessing brain simultaneously

#### Merge Driver (`scripts/merge-brain-jsonl.mjs`)
- **Type:** Custom git merge driver (registered in `.gitattributes`)
- **Strategy:** Entity-level 3-way merge (preserve concurrent edits across branches)
- **Conflict resolution:**
  - Same entity edited on both sides → keep higher-confidence version
  - New entities on both sides → merge (deduplicate by name)
  - Deletions → respect deletion intent
- **Fallback:** JSONL format fallback if entity merge fails

---

### 3. Code Intelligence Layer (`scripts/lib/code-intel/`)

Built-in code intelligence powered by ast-grep. Zero external dependencies beyond `@ast-grep/napi`. Supports JS/TS/TSX natively; Python via optional `@ast-grep/lang-python`.

#### Modules (10)

| Module | Purpose |
|--------|---------|
| `parser.mjs` | ast-grep wrapper for JS/TS/TSX (built-in) + Python (optional) |
| `extractor.mjs` | Entry point — dispatches to language-specific extractors |
| `extractor-js.mjs` | Symbol & relation extraction for JS/TS/TSX |
| `extractor-py.mjs` | Symbol & relation extraction for Python |
| `graph.mjs` | In-memory CodeGraph data structure (Map-based, O(1) symbol lookup) |
| `code-io.mjs` | JSONL persistence with mtime caching for fast incremental rebuilds |
| `impact.mjs` | 3-hop BFS blast radius analysis |
| `indexer.mjs` | Full + incremental indexing via git diff |
| `process-detector.mjs` | DFS-based execution flow detection |
| `index.mjs` | Public API facade (single import point) |

#### Impact Risk Levels

| Depth | Risk | Meaning |
|-------|------|---------|
| d=1 | WILL_BREAK | Direct callers/importers — must update |
| d=2 | LIKELY_AFFECTED | Indirect dependencies — should test |
| d=3 | MAY_NEED_TESTING | Transitive — test if on critical path |

#### Performance
- Full index (85 files): ~2s
- Symbol queries: <10ms
- Impact analysis: <20ms
- Execution flow detection: ~50ms

---

### 4. CLI Layer

#### Brain CLI (`scripts/brain-cli.mjs`)
- **Entry point:** `brain` (installed via `package.json` bin field)
- **Subcommands:**
  - `brain search <query>` — Hybrid semantic + keyword search
  - `brain health` — Run health checks (entity counts, stale nodes, index freshness)
  - `brain index [--force]` — Build/rebuild embedding index
  - `brain export` — Export to brain.jsonl
  - `brain stale` — Report stale observations (>180 days)
  - `brain serve` — Launch MCP memory server
  - `brain view` — Open dashboard viewer
  - `brain help` — Show CLI help

#### Skill Distribution (`scripts/lib/skill-adapters.mjs`, `skill-export.mjs`, `hook-export.mjs`, `skills-module.mjs`)
- **Purpose:** Export hermit skills, commands, and hooks from `catalog/` to 7 AI agents
- **Agents:** Claude Code, Cursor, Cline, Gemini CLI, Windsurf, Codex, OpenCode — unified AGENTS config with nested skills/commands/hooks keys
- **Write strategies:**
  - `per-file` — One file per item (mkdir + overwrite) — Claude, Cursor, Cline, OpenCode
  - `merge-single` — Section markers for idempotent merge into shared file — Gemini, Codex
  - Skill markers: `<!-- hermit:skill:name -->`, command markers: `<!-- hermit:cmd:name -->`
- **Hook export:** File copying + lib/ co-location (hooks need `./lib/*.cjs` dependencies)
- **Backup:** `.hermit/backups/{filename}.bak` — one backup per export batch
- **CLI:** `hermit skills export <name|--all> --agent <agent> [--commands] [--hooks] [--project /path] [--global]`
- **MCP:** 6 tools — skill/command/hook list + export

---

### 5. Dashboard / UI Layer

#### Knowledge Graph Viewer (`viewer/index.html`)
- **Purpose:** Web-based knowledge graph browser
- **Features:**
  - Full entity name search + observation text search
  - Entity cards (name, type, observations, relationships)
  - Stale node indicators (red border, 0.6 opacity for observations >180 days)
  - Export/import controls
- **Data source:** Reads `data/brain-embeddings.json`
- **Launch:** `npm run view:live`

#### CodeGraph Viewer (`viewer/code-viewer.html`)
- **Purpose:** Standalone visualization tool for code intelligence (ast-grep symbol graph)
- **Technology:** Sigma.js v2.4.0 + Graphology v0.25.4 (same CDN as KG viewer)
- **Data source:** Loads `data/code-symbols.jsonl` (JSONL format from CodeGraph indexer)
- **Features:**
  - Force-directed graph rendering with zoom/pan controls
  - File tree sidebar with symbol hierarchy (functions, classes, methods)
  - Search/filter by symbol name, type, file path
  - Impact analysis via BFS (upstream/downstream/both directions, 3-hop depth)
  - Process flow detection (DFS execution chain visualization)
  - Business rule overlay (links code symbols to KG RULE entities)
  - Export capabilities (JSON graph, SVG diagram, PNG screenshot)
  - Keyboard shortcuts for navigation and analysis
- **Size:** 2118 LOC (standalone, zero dependencies beyond CDN scripts)
- **Launch:** Open `viewer/code-viewer.html` in browser after running `npm run build:index` (ensures code-symbols.jsonl is populated)

---

### 6. MCP Integration Layer

#### Hermit Graph MCP Server (`scripts/hermit-mcp-server.mjs`)
**Single unified server with 28 tools + 1 resource across 7 modules (stdio JSON-RPC transport)**

**Module Architecture:**
```
hermit-mcp-server.mjs (entry point)
  ├── Memory Module (10 tools) — KG CRUD
  ├── CodeGraph Module (5 tools) — Built-in code intelligence (ast-grep)
  ├── Intelligence Module (3 tools) — Audit trail, consolidation, branch context
  ├── Unified Search (2 tools) — Cross-KG + code search, health checks
  ├── Session Module (1 tool + 1 resource) — Cross-agent session context
  ├── Skills Module (6 tools) — Multi-agent skill, command & hook distribution
  └── Skill Search Module (1 tool) — Keyword search across skill metadata
```

**Module Registration Pattern:**
Each module exports `register(server, context)` function, called sequentially by server entry point. Shared context provides `brainPath`, `packageRoot`, `log`, and module refs (`getEntities`, `getRelations`).

**Memory Module Tools (10):**
1. `hermit_create_entities` — Create/merge entities in KG (dedup by name, case-insensitive)
2. `hermit_create_relations` — Add relation edges (from/to/relationType)
3. `hermit_search_nodes` — Keyword search across entity names, types, and observations
4. `hermit_semantic_search` — Hybrid vector + keyword search (falls back to keyword-only)
5. `hermit_open_nodes` — Read full entity details by name(s)
6. `hermit_add_observations` — Append observations to existing entity
7. `hermit_archive_entities` — Soft-delete entities (set _archived=true)
8. `hermit_archive_observations` — Soft-archive specific observations by content match
9. `hermit_get_related` — Traverse relations from an entity (BFS, 1-5 hops)
10. `hermit_read_graph` — Read knowledge graph with filters (minimal/summary/full detail levels)

**CodeGraph Module Tools (5):**
1. `hermit_query` — Concept-based code search via ast-grep
2. `hermit_context` — 360-degree symbol view (callers, callees, flows) via ast-grep
3. `hermit_impact` — Blast radius analysis (upstream/downstream/both) via ast-grep
4. `hermit_detect_changes` — Pre-commit scope check (staged/all/compare) via ast-grep
5. `hermit_index` — Index/re-index a project for code intelligence (runs ast-grep analyze)

**Intelligence Module Tools (3):**
1. `hermit_audit_trail` — Observation change history (append-only log)
2. `hermit_consolidate` — Dedupe entities, flag contradictions (dry-run support)
3. `hermit_branch_context` — Detect git branch, set/clear branch filter

**Unified Search Module Tools (2):**
1. `hermit_unified_search` — Parallel KG + code search, ranked by relevance
2. `hermit_health` — Brain health check (5 automated checks, score 0-100)

**Session Module (1 tool + 1 resource):**
1. `hermit_session_start` — Auto-detect project scope, return relevant entities + branch + graph stats
2. `hermit://context/auto` — MCP resource returning markdown-formatted session context

**Skills Module Tools (6):**
1. `hermit_skill_list` — List available skills with per-agent compatibility matrix
2. `hermit_skill_export` — Export skill(s) to target agent (claude/cursor/gemini/codex/all)
3. `hermit_command_list` — List available commands (slash commands) from catalog
4. `hermit_command_export` — Export command(s) to target agent
5. `hermit_hook_list` — List available hooks with agent compatibility
6. `hermit_hook_export` — Export hook(s) + lib/ dependencies to target agent

**Transport:** stdio (JSON-RPC over stdin/stdout) — direct integration with Claude Code

---

## Data Flow

### Write Flow (Brain Update)

```
User Action (code analysis, bug discovery, decision made)
  ↓
Create/update entity (BIZ:Project:Rule, PATTERN:Architecture, etc.)
  ↓
Acquire file lock (brain.jsonl)
  ↓
Append entity to brain.jsonl (JSONL append-only)
  ↓
Release file lock
  ↓
[Async] Rebuild embedding index (if index is stale)
```

### Read Flow (Search)

```
User Query ("find patterns related to auth")
  ↓
Brain CLI or MCP Client calls semantic_search()
  ↓
Load brain-embeddings.json (pre-computed)
  ↓
Embed query text (using embedding-service)
  ↓
Compute hybrid scores (0.7 semantic + 0.3 keyword)
  ↓
Load brain.jsonl entries for top-N results
  ↓
Return hydrated results (name, type, observations, confidence)
```

### Code Intelligence Flow

```
hermit_query / hermit_impact / hermit_context called
  ↓
Check if data/code-symbols.jsonl exists + is fresh (mtime cache)
  ↓
[First use / stale] Run ast-grep analyze → extract symbols + relations
  ↓
[Incremental] git diff → extract only changed files
  ↓
Write updated data/code-symbols.jsonl
  ↓
Load graph into memory (Map-based, O(1) lookup)
  ↓
Execute query / BFS impact / DFS process detection
  ↓
Return results with depth/risk annotations
```

### Merge Flow (Git)

```
User: git merge feature-branch
  ↓
Git detects brain.jsonl conflict
  ↓
Invokes merge-brain-jsonl.mjs (custom driver)
  ↓
Entity-level 3-way merge (keep high-confidence, merge new)
  ↓
Auto-resolve (no manual conflict resolution needed)
  ↓
Commit merged brain.jsonl
```

---

## Concurrency Model

### Single-Writer, Multi-Reader

- **Brain JSONL:** File-locked writes, lock-free reads (JSONL append-only)
- **Embedding Index:** Rebuilt atomically (single rebuild task)
- **Code Symbols:** Written atomically; incremental rebuilds via git diff

### File Lock Service
- Blocks concurrent brain.jsonl writers
- Readers proceed without waiting
- Timeout: 5s (configurable)
- Graceful fallback: If lock unavailable, write fails with clear error

---

## Feature History

| Feature | Module | Version |
|---------|--------|---------|
| Semantic search (hybrid) | embedding-service, semantic-search | v3 |
| Enhanced dashboard | viewer/index.html | v3 |
| Multi-agent protocol (file locking) | file-lock.mjs | v3 |
| Branch-aware merge | merge-brain-jsonl.mjs | v3 |
| Unified CLI | brain-cli.mjs | v3 |
| Skill Distribution | skill-adapters, skill-export, skills-module | v4.1 |
| Cross-Agent Session Context | session-module, session-recall | v4.2 |
| Rules File Setup (Cursor/Windsurf/Cline/Codex) | setup-project | v4.2 |
| Command + Hook Distribution | skill-export, hook-export, skills-module | v4.3 |
| Hook Adapters | recall-core.cjs, session-core.cjs + agent adapters | v4.3 |
| Skill Search + Index | skill-index.mjs, skill-search-module.mjs | v5.0 |
| Token-Aware KG Injection | recall-core.cjs (estimateChars, selectDetailLevel) | v5.0 |
| Smart Skill Activation | skill-adapters.mjs (paths: frontmatter) | v5.0 |
| Post-Response KG Update | entity-extractor.cjs, kg-auto-update.cjs + adapters | v5.0 |
| KG Context Forwarding | recall-core.cjs (detectPromptType, expandRelations) | v5.0 |
| OpenCode Export (6th agent) | skill-adapters.mjs | v5.0 |
| Built-in code intelligence (ast-grep) | scripts/lib/code-intel/ (10 modules) | v6.0.0 |
| Windsurf agent support (7th agent) | skill-adapters.mjs | v6.0.0 |
| Incremental indexing via git diff | indexer.mjs | v6.0.0 |
| 3-hop BFS blast radius analysis | impact.mjs | v6.0.0 |
| DFS execution flow detection | process-detector.mjs | v6.0.0 |
| CodeGraph Viewer (code intelligence UI) | viewer/code-viewer.html (Sigma.js + Graphology) | v6.2.0 |

---

## Deployment

### Development
```bash
npm install
npm run setup:all
npm run view:live
```

### Production
- JSONL acts as local store (no external DB required)
- CI/CD: Auto-rebuild embeddings on push

---

## Supporting Modules

### Brain I/O Layer (`scripts/lib/brain-io.mjs`)
- `readBrain(brainPath)` — Load entities Map + relations array (lock-free, safe for concurrent reads)
- `writeBrain(brainPath, entities, relations)` — Serialize to JSONL (call inside `withBrainLock`)
- `withBrainLock(brainPath, fn)` — Acquire exclusive write lock, execute callback, release

### Audit Trail (`scripts/lib/audit-trail.mjs`)
- Append-only observation history tracking
- `getEntityHistory(entity)` — Extract change log from `_history[]` metadata
- Supports `_archivedAt`, `_reason` fields for observation deletion

### Branch Context (`scripts/lib/branch-context.mjs`)
- Detect current git branch via `git rev-parse --abbrev-ref HEAD`
- Store branch-specific filters in `~/.hermit-branch-context.json`
- Allow filtering search/export by branch

### Brain Health Checks (`scripts/lib/brain-health-checks.mjs`)
Five automated checks:
1. **Stale Entries** — observations >180 days without update
2. **Duplicates** — entities with similar names (Levenshtein distance)
3. **Orphan Nodes** — entities with no relations to other entities
4. **Low Confidence** — observations with confidence <0.7
5. **Missing Relations** — potential unmapped connections (ML-based)

Returns score 0-100 with recommendations.

---

## Dependencies (v6.0.0)

| Package | Version | Purpose |
|---------|---------|---------|
| @modelcontextprotocol/sdk | ^1.29.0 | MCP server framework |
| @huggingface/transformers | ^4.0.1 | Semantic embeddings (ONNX) |
| @ast-grep/napi | ^0.42.1 | Built-in code intelligence |
| zod | ^4.3.6 | Tool parameter validation |
| dotenv | ^16.4.0 | Environment config |
| @ast-grep/lang-python | ^0.0.6 | Python support (optional) |

---

## Error Handling

### Graceful Degradation
- Embedding model unavailable → semantic search disabled, keyword-only
- File lock timeout → write operation fails with clear error
- Stale embeddings → search works but may return less relevant results
- ast-grep unavailable → CodeGraph tools return error with reindex instructions
- Python lang pack missing → Python files skipped, JS/TS still indexed

---

## Monitoring

### Health Checks (`brain health`)
1. Entity count + type distribution
2. Stale observations (>180 days)
3. Embedding index freshness
4. File lock health
5. Code symbol index freshness
