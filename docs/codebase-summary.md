# Codebase Summary — hermit-graph

## Quick Overview

**hermit-graph v6.1.0** is a unified knowledge graph system with MCP server integration. Single server provides 28 tools + 1 resource across 7 modules: Memory (KG CRUD), CodeGraph (ast-grep built-in), Intelligence (audit/consolidation), Unified Search, Session Context, Skills Distribution, and Skill Search. Multi-agent hooks (auto-recall + auto-update) across 7 agents. Built on JSONL + semantic embeddings + MCP v1.29.0. v6.1 adds Unified Impact Bridge (code + business rule analysis), auto-learn on setup, and BUSINESS.md auto-generation.

**Repository root:** `/`
**Primary language:** JavaScript (Node.js)
**Package manager:** npm
**MCP Server:** stdio JSON-RPC transport, v4-native entry point at `scripts/hermit-mcp-server.mjs`
**Skill Distribution:** Export skills to 7 AI agents (Claude, Cursor, Gemini, Windsurf, Cline, Codex, OpenCode) via adapter transforms

---

## Directory Structure

```
D:/Project/Personal Project/hermit-graph/
├── data/
│   ├── brain.jsonl                # Knowledge graph (single source of truth)
│   ├── brain-embeddings.json      # Pre-computed semantic embeddings (v3)
│   ├── code-symbols.jsonl         # Auto-generated code intelligence index (v6)
│   ├── conventions/               # Project conventions database
│   └── .model-cache/              # Hugging Face model cache (gitignored)
│
├── scripts/
│   ├── lib/
│   │   ├── memory-module.mjs                # 10 KG CRUD tools (create/search/get/update/delete/etc)
│   │   ├── codegraph-module.mjs             # 5 code intelligence tools (ast-grep powered)
│   │   ├── intelligence-module.mjs          # 3 intelligence tools (audit-trail/consolidate/branch-context)
│   │   ├── unified-search.mjs               # 2 cross-module tools (unified-search/health)
│   │   ├── brain-io.mjs                     # Read/write JSONL with lock wrapper
│   │   ├── audit-trail.mjs                  # Append-only observation history
│   │   ├── branch-context.mjs               # Git branch detection + filter
│   │   ├── brain-health-checks.mjs          # 5 health check implementations
│   │   ├── embedding-service.mjs            # Embedding generation (Hugging Face ONNX)
│   │   ├── semantic-search.mjs              # Hybrid search (semantic + keyword)
│   │   ├── file-lock.mjs                    # Cross-process file locking
│   │   ├── session-module.mjs               # MCP tool (hermit_session_start) + resource (context/auto)
│   │   ├── session-recall.mjs               # Scope detection, keyword matching, entity scoring
│   │   ├── skill-adapters.mjs               # Unified agent configs (skills/commands/hooks per agent)
│   │   ├── skill-export.mjs                 # Skill + command export engine (discover, compat, write)
│   │   ├── hook-export.mjs                  # Hook export engine (discover, copy, lib/ co-location)
│   │   ├── skills-module.mjs                # 6 MCP tools (skill/command/hook list+export)
│   │   ├── skill-index.mjs                  # Skill metadata index (catalog + project skills)
│   │   ├── skill-search-module.mjs          # hermit_skill_search MCP tool
│   │   ├── project-skill-export.mjs         # Project skill export engine
│   │   ├── md-strip.mjs                     # Claude-ref stripping for cross-agent export
│   │   ├── biz-linker.mjs                   # Business rule linker (KG RULE + BUSINESS.md enrichment)
│   │   ├── business-md-generator.mjs        # BUSINESS.md auto-generator from scanProject()
│   │   ├── project-learner.mjs              # Deterministic project scanner (auto-learn on setup)
│   │   ├── parse-observation.mjs            # Observation parsing utility
│   │   ├── resolve-brain-path.mjs           # Brain path resolver
│   │   └── code-intel/                      # Built-in code intelligence (v6)
│   │       ├── parser.mjs                   # ast-grep wrapper (JS/TS/Python)
│   │       ├── extractor.mjs                # Symbol & relation extraction orchestrator
│   │       ├── extractor-js.mjs             # JS/TS extractor
│   │       ├── extractor-py.mjs             # Python extractor
│   │       ├── graph.mjs                    # In-memory CodeGraph data structure
│   │       ├── code-io.mjs                  # JSONL persistence (mtime-cached)
│   │       ├── impact.mjs                   # Blast radius analysis (3-hop BFS)
│   │       ├── indexer.mjs                  # Full + incremental indexing
│   │       ├── process-detector.mjs         # Execution flow detection
│   │       └── index.mjs                    # Public API facade
│   │
│   ├── hermit-mcp-server.mjs           # MCP server entry point (v4) — loads 6 modules
│   ├── migrate-v3-to-v4.mjs            # Migration script (v3 → v4 data format)
│   ├── test-v4.mjs                     # 100 unit tests + 9 e2e
│   ├── brain-cli.mjs                   # Unified CLI (backward compat)
│   ├── build-embedding-index.mjs       # Index builder
│   ├── merge-brain-jsonl.mjs           # Git merge driver
│   ├── brain-health.mjs                # Health check script (uses brain-health-checks.mjs)
│   ├── setup-project.mjs               # Project initialization (v6.1: auto-learn + BUSINESS.md)
│   ├── view-graph.mjs                  # Graph viewer (localhost HTTP server)
│   ├── setup-semantic.mjs              # Semantic setup
│   ├── sync-to-neo4j.mjs               # Neo4j synchronizer
│   ├── stale-report.mjs               # Stale observation report
│   ├── backfill-confidence.mjs        # Add confidence prefix to legacy data
│   └── export-db-to-jsonl.mjs         # Export DB to JSONL
│
├── catalog/hooks/
│   ├── lib/
│   │   ├── recall-core.cjs              # Shared recall logic (keyword extraction, search, token budget, expansion)
│   │   ├── entity-extractor.cjs         # Regex entity extraction from assistant messages (v5 P4)
│   │   └── session-core.cjs             # Session lifecycle management
│   ├── kg-auto-recall.cjs               # Claude Code UserPromptSubmit hook
│   ├── kg-auto-recall-{cursor,gemini,cline,codex}.cjs  # Agent-specific recall adapters
│   ├── kg-auto-update.cjs               # Claude Code Stop hook (v5 P4)
│   ├── kg-auto-update-{cursor,gemini,cline,codex}.cjs  # Agent-specific update adapters
│   └── session-hook-{cursor,gemini,cline,codex}.cjs    # Session lifecycle adapters
│
├── viewer/
│   ├── index.html                      # Knowledge Graph dashboard UI
│   ├── code-viewer.html                # CodeGraph visualization tool (Sigma.js + Graphology)
│   ├── data.json                       # Static data source (for development)
│   └── [CSS/JS assets]
│
├── docs/
│   ├── system-architecture.md          # Architecture
│   ├── codebase-summary.md             # This file
│   ├── project-changelog.md            # Changelog
│   ├── development-roadmap.md          # Roadmap
│   └── [other docs]
│
├── .gitattributes                      # Git merge driver config
├── package.json                        # npm config + brain CLI bin (v4)
├── README.md                           # Project introduction
└── CLAUDE.md                           # Claude Code instructions

```

---

## Core Modules (v6)

### MCP Server Entry & Modules
| Module | Purpose | Tools |
|--------|---------|-------|
| `hermit-mcp-server.mjs` | Unified server entry point | Loads 6 modules via `register()` pattern |
| `scripts/lib/memory-module.mjs` | KG CRUD operations | 10 tools (create/search/get/update/delete/export/etc) |
| `scripts/lib/codegraph-module.mjs` | Built-in code intelligence (ast-grep) | 5 tools (query/context/impact/detect-changes/index) |
| `scripts/lib/intelligence-module.mjs` | Audit + consolidation | 3 tools (audit-trail/consolidate/branch-context) |
| `scripts/lib/unified-search.mjs` | Cross-module search | 2 tools (unified-search/health) |
| `scripts/lib/session-module.mjs` | Cross-agent session context | 1 tool (session-start) + 1 resource (context/auto) |
| `scripts/lib/skills-module.mjs` | Skill/command/hook distribution | 6 tools (skill/command/hook list+export) |

### Code Intelligence (v6 — `scripts/lib/code-intel/`)
| Module | Purpose |
|--------|---------|
| `index.mjs` | Public API facade — single import for all code intel operations |
| `parser.mjs` | ast-grep wrapper; JS/TS and Python language support |
| `extractor.mjs` | Symbol & relation extraction orchestrator |
| `extractor-js.mjs` | JS/TS-specific symbol extraction (functions, classes, imports) |
| `extractor-py.mjs` | Python-specific symbol extraction |
| `graph.mjs` | In-memory CodeGraph data structure (nodes + edges) |
| `code-io.mjs` | JSONL persistence with mtime-based cache invalidation |
| `impact.mjs` | Blast radius analysis via 3-hop BFS |
| `indexer.mjs` | Full and incremental indexing |
| `process-detector.mjs` | Execution flow detection |

### Supporting Libraries
| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `scripts/lib/brain-io.mjs` | Read/write JSONL with locking | `readBrain()`, `writeBrain()`, `withBrainLock()` |
| `scripts/lib/audit-trail.mjs` | Append-only history | `getEntityHistory()`, `archiveObservation()` |
| `scripts/lib/branch-context.mjs` | Git branch detection | `detectBranch()`, `getBranchFilter()`, `setBranchFilter()` |
| `scripts/lib/brain-health-checks.mjs` | Health check logic | `checkStale()`, `checkDuplicates()`, `checkOrphans()`, etc. |
| `scripts/lib/embedding-service.mjs` | ONNX embeddings | `embed()`, `embedBatch()`, `isAvailable()` |
| `scripts/lib/semantic-search.mjs` | Hybrid search | `search()` (0.7 semantic + 0.3 keyword) |
| `scripts/lib/file-lock.mjs` | Cross-process sync | `withLock()`, `acquireLock()`, `releaseLock()` |
| `scripts/lib/skill-adapters.mjs` | Unified agent configs | `AGENTS`, `parseFrontmatter()` |
| `scripts/lib/skill-export.mjs` | Skill + command export | `discoverSkills()`, `discoverCommands()`, `exportSkill()`, `exportCommand()` |
| `scripts/lib/hook-export.mjs` | Hook export | `discoverHooks()`, `exportHook()`, `exportAllHooks()`, `parseHookName()` |
| `scripts/lib/session-recall.mjs` | Session context scoring | `recallForScope()`, `detectScope()`, `scoreEntity()` |
| `scripts/lib/biz-linker.mjs` | Business rule enrichment | `enrichImpactWithBizRules()` — links CodeGraph impact to KG RULE entities + BUSINESS.md chains |
| `scripts/lib/business-md-generator.mjs` | BUSINESS.md auto-gen | `generateBusinessMd()`, `writeBusinessMdIfMissing()` — pre-fills from scanProject() |
| `scripts/lib/project-learner.mjs` | Auto-learn on setup | `scanProject()`, `learnProject()` — deterministic project scanner → BIZ + TECH entities |
| `scripts/lib/parse-observation.mjs` | Observation parsing | `parseObservation()`, `obsText()` |

### CLI & Utility Scripts
| Script | Purpose | Command |
|--------|---------|---------|
| `scripts/brain-cli.mjs` | Unified CLI (backward compat) | `hermit search`, `hermit health`, `hermit index`, etc. |
| `scripts/skills-manager.mjs` | Skill install/remove/export | `hermit skills [list\|add\|remove\|export]` |
| `scripts/migrate-v3-to-v4.mjs` | Data migration | `node scripts/migrate-v3-to-v4.mjs` |
| `scripts/setup-project.mjs` | Project init | `npm run setup:all` |
| `scripts/brain-health.mjs` | Health check (uses health-checks.mjs) | `brain health` |
| `scripts/merge-brain-jsonl.mjs` | Git merge driver | Auto-invoked by git merge |

### UI
| File | Purpose |
|------|---------|
| `viewer/index.html` | Web dashboard (entity browser, search, stale indicators) |
| `viewer/code-viewer.html` | CodeGraph visualization (2118 LOC) — force-directed graph rendering, impact analysis, process flow detection, business rule overlay, export (JSON/SVG/PNG) |

---

## Key Algorithms

### Hybrid Search (Semantic + Keyword)
**File:** `scripts/lib/semantic-search.mjs`

```
Query → Embed query text (384-dim vector)
      → Load pre-computed embeddings
      → For each entity:
         score = 0.7 * cosine_similarity(query_vec, entity_vec)
               + 0.3 * keyword_relevance(query, entity)
      → Sort by score descending
      → Return top-N results
```

### Code Intelligence — Indexing & Impact
**Files:** `scripts/lib/code-intel/`

```
hermit_index(cwd)
  → Walk source files (JS/TS/Python)
  → ast-grep parse → extract symbols + relations
  → Persist to data/code-symbols.jsonl (mtime-cached)

hermit_impact(target, direction)
  → Load graph from code-symbols.jsonl
  → BFS up to 3 hops (upstream or downstream)
  → Return nodes by depth with risk level (d=1 WILL BREAK, d=2 LIKELY, d=3 MAY)
```

### File Locking (Multi-Process Safety)
**File:** `scripts/lib/file-lock.mjs`

```
Writer →  Acquire lock (brain.jsonl)
       →  Read current file
       →  Append new entity
       →  Write updated file
       →  Release lock

Reader →  (No lock needed, JSONL append-only)
       →  Read brain.jsonl directly
```

### Entity-Level Git Merge
**File:** `scripts/merge-brain-jsonl.mjs`

```
Conflict in brain.jsonl
  ↓
Parse both JSONL versions into entity maps
  ↓
For each entity:
  - Same on both sides? Keep as-is
  - New on one side? Add (merge)
  - Edited on both sides? Keep higher confidence
  - Deleted on one side? Respect deletion
  ↓
Serialize merged entities back to JSONL
  ↓
Commit result (no manual conflict resolution)
```

---

## Data Model

### Entity Format (JSONL)
```json
{
  "id": "RULE:Project:RuleName",
  "type": "biz-rule",
  "name": "RuleName",
  "project": "Project",
  "tier": "RULE",
  "scope": "Project",
  "label": "RuleName",
  "created": "2025-01-15T10:00:00Z",
  "updated": "2025-03-26T14:30:00Z",
  "observations": [
    {
      "text": "Max discount is 50%",
      "confidence": 0.95,
      "date": "2025-01-15"
    }
  ]
}
```

### Embedding Index Format
```json
{
  "entities": [
    {
      "id": "RULE:Project:RuleName",
      "embedding": [0.12, -0.34, ..., 0.56]  // 384-dim vector
    }
  ]
}
```

---

## Setup & Development

### First-Time Setup
```bash
npm install
npm run setup:all  # Initializes DB, semantic model, conventions
```

### Development Server
```bash
npm run view:live  # Export + serve dashboard at localhost:3000
```

### Building Embedding Index
```bash
npm run build:index     # Build index from brain.jsonl
npm run build:index:force  # Rebuild even if index is fresh
```

### Testing
```bash
npm test  # 100 unit tests + 9 e2e (test-v4.mjs)
```

---

## Dependencies (v6)

```json
{
  "@ast-grep/napi": "^0.42.1",           // Built-in code intelligence (ast-grep)
  "@modelcontextprotocol/sdk": "^1.29.0", // MCP server framework
  "@huggingface/transformers": "^4.0.1",  // ONNX embeddings (Xenova/all-MiniLM-L6-v2)
  "zod": "^4.3.6",                        // Tool parameter validation
  "dotenv": "^16.4.0"                     // Environment config
}
```

**Optional:**
```json
{
  "@ast-grep/lang-python": "^0.0.6"      // Python language support for ast-grep
}
```

## v3 → v4 Migration

**Data Format Change:**
Old: Simple string observations
New: Object observations with `content`, `_branch`, `_archived`, `_archivedAt`, `_history[]` fields

**Server Change:**
Old: Two separate MCP servers (launch-memory-mcp.mjs, launch-conventions-mcp.mjs)
New: Single unified server (hermit-mcp-server.mjs) with 6 registered modules

**Run migration script before using v4 MCP:**
```bash
node scripts/migrate-v3-to-v4.mjs
```

Maps old brain.jsonl entities to v4 format (preserves all observations).

---

## v6 Changes (Latest)

| Component | Change | Status |
|-----------|--------|--------|
| CodeGraph Module | Replaced GitNexus subprocess with built-in ast-grep code intelligence | Complete |
| code-intel/ | 10 new modules: parser, extractor, extractor-js, extractor-py, graph, code-io, impact, indexer, process-detector, index | Complete |
| codegraph-module.mjs | 5 tools (query/context/impact/detect-changes/index) — zero external CLI dependency | Complete |
| data/code-symbols.jsonl | Auto-generated code index (mtime-cached, gitignored) | Complete |
| gitnexus-runner.mjs | Removed — no longer needed | Complete |
| Agents | Expanded to 7 (Claude, Cursor, Gemini, Windsurf, Cline, Codex, OpenCode) | Complete |
| Tests | 100 unit tests + 9 e2e (test-v4.mjs) | Complete |
| Dependencies | Removed neo4j-driver; added @ast-grep/napi ^0.42.1; zod upgraded to ^4.3.6 | Complete |
| MCP Server | Unified hermit-mcp-server.mjs (28 tools + 1 resource, 7 modules) | Complete |
| Memory Module | 10 KG CRUD tools | Complete |
| Intelligence Module | 3 tools (audit-trail/consolidate/branch-context) | Complete |
| Session Module | 1 MCP tool (hermit_session_start) + 1 resource (context/auto) | Complete |
| Skills Module | 6 MCP tools (skill/command/hook list+export) | Complete |
| Hook Adapters | Auto-recall + session + auto-update hooks for Cursor, Gemini CLI, Cline, Codex | Complete |

---

## v6.1 Changes (Unified Impact Bridge)

| Component | Change | Status |
|-----------|--------|--------|
| `biz-linker.mjs` | New — enriches CodeGraph impact with KG RULE entities + BUSINESS.md chains | Complete |
| `business-md-generator.mjs` | New — auto-generates BUSINESS.md from scanProject() output | Complete |
| `project-learner.mjs` | New — deterministic project scanner, writes BIZ + TECH entities on setup | Complete |
| `view-graph.mjs` | New — localhost HTTP server for graph viewer | Complete |
| `codegraph-module.mjs` | Enhanced — `hermit_impact` now returns `bizRules[]` + `bizChains[]` layers | Complete |
| `setup-project.mjs` | Enhanced — auto-learn + BUSINESS.md generation + recursive hook lib/ copy | Complete |
| `kg-auto-update.cjs` | Fixed — added 5s timeout guard, PascalCase naming consistency | Complete |
| `project-learner.mjs` | Fixed — Yarn Berry workspace object format, scoped npm name handling | Complete |
| `codegraph-module.mjs` | Fixed — ensureIndex race condition (promise dedup), resolveDataDir absolute paths | Complete |
| Package | Removed `.claude-settings.json` from npm files array | Complete |

---

## Code Quality

- **Linting:** ESLint (configured in `.eslintrc.js` if present)
- **Testing:** Node.js native test runners
- **Error handling:** Try-catch + graceful fallback (e.g., disabled semantic search if model unavailable)
- **Concurrency:** File locking for safe multi-process access

---

## Git Integration

### Custom Merge Driver
- **Config:** `.gitattributes` defines `merge=brain-jsonl` for `data/brain.jsonl`
- **Driver:** `scripts/merge-brain-jsonl.mjs` handles 3-way entity merge
- **Benefit:** Automatic conflict resolution across branches (no manual merging)

### Ignore List
- `data/.model-cache/` — Hugging Face model downloads (too large to commit)
- `data/code-symbols.jsonl` — auto-generated code index (regenerated on demand)
- `node_modules/` — npm dependencies

---

## Performance Notes

- **Embedding model:** ~23 MB (ONNX, downloaded once and cached)
- **Search latency:** <100ms for 1K entities (hybrid scoring)
- **JSONL append:** <10ms per entity (lock-free reads)
- **Embedding rebuild:** ~5-10s for 5K entities (one-time or periodic)
- **Code index (full):** ~2s for typical project
- **Code query latency:** <10ms (in-memory graph lookup)
- **Impact analysis:** <20ms (3-hop BFS)

---

## Maintenance & Monitoring

### Health Check
```bash
brain health
```

Reports:
- Entity counts by type
- Stale observations (>180 days old)
- Embedding index freshness
- File lock availability

### Stale Report
```bash
brain stale
```

Shows observations not updated in >180 days.

---

## Future Enhancements

- [ ] Multi-model embedding support (domain-specific)
- [ ] Advanced graph analytics
- [ ] Web UI for entity editing
- [ ] Incremental embedding updates (skip unchanged entities)
