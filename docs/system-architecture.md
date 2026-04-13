# System Architecture — hermit-graph

## Overview

hermit-graph is a distributed knowledge graph system for AI-assisted development. It captures, organizes, and retrieves project intelligence (architecture decisions, code patterns, business rules, incidents) across development sessions. **v4.2:** Unified MCP server with 22 tools + 1 resource across 6 modules.

**Core technology:** JSONL-based knowledge graph + MCP server v1.29.0 + semantic embeddings + GitNexus integration

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

#### Neo4j Sync (Optional)
- **Purpose:** Real-time multi-user sync and analytics
- **Sync script:** `scripts/sync-to-neo4j.mjs`
- **Status:** Optional (fallback to local JSONL if unavailable)

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

### 3. CLI Layer

#### Brain CLI (`scripts/brain-cli.mjs`)
- **Entry point:** `brain` (installed via `package.json` bin field)
- **Subcommands:**
  - `brain search <query>` — Hybrid semantic + keyword search
  - `brain health` — Run health checks (entity counts, stale nodes, index freshness)
  - `brain index [--force]` — Build/rebuild embedding index
  - `brain export` — Export Neo4j to brain.jsonl
  - `brain stale` — Report stale observations (>180 days)
  - `brain serve` — Launch MCP memory server
  - `brain view` — Open dashboard viewer
  - `brain help` — Show CLI help

#### Skill Distribution (`scripts/lib/skill-adapters.mjs`, `skill-export.mjs`, `skills-module.mjs`)
- **Purpose:** Export hermit skills from `catalog/skills/` to 4 AI agents in native formats
- **Agents:** Claude Code (per-file `.claude/skills/`), Cursor (MDC `.cursor/rules/`), Gemini (merge-single `GEMINI.md`), Codex (merge-single `AGENTS.md`)
- **Write strategies:**
  - `per-file` — One file per skill (mkdir + overwrite)
  - `merge-single` — Section markers (`<!-- hermit:skill:name start/end -->`) for idempotent merge into shared file
- **Backup:** `.hermit/backups/{filename}.bak` — one backup per export batch (not per skill)
- **CLI:** `hermit skills export <name|--all> --agent <agent> [--project /path] [--global]`
- **MCP:** `hermit_skill_list` (browse catalog), `hermit_skill_export` (write to agent)

---

### 4. Dashboard / UI Layer

#### Viewer (`viewer/index.html`)
- **Purpose:** Web-based knowledge graph browser
- **Features:**
  - Full entity name search + observation text search
  - Entity cards (name, type, observations, relationships)
  - Stale node indicators (red border, 0.6 opacity for observations >180 days)
  - Export/import controls
- **Data source:** Reads `data/brain-embeddings.json` and Neo4j (if available)
- **Launch:** `npm run view:live`

---

### 5. MCP Integration Layer (v4)

#### Hermit Graph MCP Server (`scripts/hermit-mcp-server.mjs`)
**Single unified server with 21 tools across 5 modules (stdio JSON-RPC transport)**

**Module Architecture:**
```
hermit-mcp-server.mjs (entry point)
  ├── Memory Module (10 tools) — KG CRUD
  ├── CodeGraph Module (4 tools) — GitNexus wrapper
  ├── Intelligence Module (3 tools) — Audit trail, consolidation, branch context
  ├── Unified Search (2 tools) — Cross-KG + code search, health checks
  ├── Session Module (1 tool + 1 resource) — Cross-agent session context
  └── Skills Module (2 tools) — Multi-agent skill distribution
```

**Module Registration Pattern:**
Each module exports `register(server, context)` function, called sequentially by server entry point. Shared context provides `brainPath`, `packageRoot`, `log`, and module refs (`getEntities`, `getRelations`).

**Memory Module Tools (10):**
1. `hermit_create_entities` — Create/merge entities in KG (dedup by name, case-insensitive)
2. `hermit_create_relations` — Add relation edges (from/to/relationType)
3. `hermit_search_entities` — Keyword + semantic search in KG (hybrid scoring)
4. `hermit_get_entity` — Fetch single entity with all observations
5. `hermit_update_entity` — Append observations to existing entity
6. `hermit_delete_entity` — Archive/remove entity
7. `hermit_list_entities` — List entities (by type, limit)
8. `hermit_bulk_import` — Batch create from external source
9. `hermit_export_subgraph` — Export filtered entity set to JSON
10. `hermit_get_relations` — List relations (optionally filtered)

**CodeGraph Module Tools (4):**
1. `hermit_query` — Concept-based code search via GitNexus
2. `hermit_context` — 360-degree symbol view (callers, callees, flows)
3. `hermit_impact` — Blast radius analysis (upstream/downstream/both)
4. `hermit_detect_changes` — Pre-commit scope check (staged/all/compare)

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

**Skills Module Tools (2):**
1. `hermit_skill_list` — List available skills with per-agent compatibility matrix
2. `hermit_skill_export` — Export skill(s) to target agent (claude/cursor/gemini/codex/all)

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
  ↓
[Optional] Sync to Neo4j
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
- **Neo4j:** Lock-free reads, transactional writes

### File Lock Service
- Blocks concurrent brain.jsonl writers
- Readers proceed without waiting
- Timeout: 5s (configurable)
- Graceful fallback: If lock unavailable, write fails with error

---

## v3 Enhancements (Completed)

| Feature | Module | Status |
|---------|--------|--------|
| Semantic search (hybrid) | embedding-service, semantic-search | Done |
| Enhanced dashboard | viewer/index.html | Done |
| Multi-agent protocol (file locking) | file-lock.mjs | Done |
| Branch-aware merge | merge-brain-jsonl.mjs | Done |
| Unified CLI | brain-cli.mjs | Done |
| Skill Distribution (v4.1) | skill-adapters, skill-export, skills-module | Done |
| Cross-Agent Session Context (v4.2) | session-module, session-recall | Done |
| Rules File Setup (v4.2) | setup-project (Cursor/Windsurf/Cline/Codex) | Done |

---

## Deployment

### Development
```bash
npm install
npm run setup:all
npm run view:live
```

### Production
- Deployment handled by Neo4j sync
- JSONL acts as local cache/fallback
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

### GitNexus Runner (`scripts/lib/gitnexus-runner.mjs`)
- Subprocess wrapper around `npx gitnexus` CLI
- 30s timeout per invocation
- Handles JSON output parsing and error propagation

### Brain Health Checks (`scripts/lib/brain-health-checks.mjs`)
Five automated checks:
1. **Stale Entries** — observations >180 days without update
2. **Duplicates** — entities with similar names (Levenshtein distance)
3. **Orphan Nodes** — entities with no relations to other entities
4. **Low Confidence** — observations with confidence <0.7
5. **Missing Relations** — potential unmapped connections (ML-based)

Returns score 0-100 with recommendations.

---

## Dependencies (v4)

| Package | Version | Purpose |
|---------|---------|---------|
| @modelcontextprotocol/sdk | ^1.29.0 | MCP server framework |
| @huggingface/transformers | ^4.0.1 | Semantic embeddings (ONNX) |
| zod | ^3.x | Tool parameter validation |
| neo4j-driver | ^5.27.0 | Graph sync (optional) |
| dotenv | ^16.4.0 | Environment config |

---

## Error Handling

### Graceful Degradation
- Embedding model unavailable → semantic search disabled, keyword-only
- Neo4j unavailable → fallback to local JSONL
- File lock timeout → write operation fails with clear error
- Stale embeddings → search works but may return less relevant results

---

## Monitoring

### Health Checks (`brain health`)
1. Entity count + type distribution
2. Stale observations (>180 days)
3. Embedding index freshness
4. File lock health
5. Neo4j sync status (if configured)

---

## Future Roadmap

- [ ] Real-time Neo4j streaming
- [ ] Full-text search optimization
- [ ] Multi-model embedding support
- [ ] Graph analytics dashboards
