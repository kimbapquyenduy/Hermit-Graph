# Codebase Summary — hermit-graph

## Quick Overview

**hermit-graph v4** is a unified knowledge graph system with MCP server integration. Single server provides 21 tools across 5 modules: Memory (KG CRUD), CodeGraph (GitNexus), Intelligence (audit/consolidation), Unified Search, and Skills Distribution. Built on JSONL + semantic embeddings + MCP v1.29.0.

**Repository root:** `/`
**Primary language:** JavaScript (Node.js)
**Package manager:** npm
**MCP Server:** stdio JSON-RPC transport, v4-native entry point at `scripts/hermit-mcp-server.mjs`
**Skill Distribution:** Export skills to 4 AI agents (Claude, Cursor, Gemini, Codex) via adapter transforms

---

## Directory Structure

```
D:/Project/Personal Project/hermit-graph/
├── data/
│   ├── brain.jsonl                # Knowledge graph (single source of truth)
│   ├── brain-embeddings.json      # Pre-computed semantic embeddings (v3)
│   ├── conventions/               # Project conventions database
│   └── .model-cache/              # Hugging Face model cache (gitignored)
│
├── scripts/
│   ├── lib/
│   │   ├── memory-module.mjs                # 10 KG CRUD tools (create/search/get/update/delete/etc)
│   │   ├── codegraph-module.mjs             # 4 GitNexus tools (query/context/impact/detect-changes)
│   │   ├── intelligence-module.mjs          # 3 intelligence tools (audit-trail/consolidate/branch-context)
│   │   ├── unified-search.mjs               # 2 cross-module tools (unified-search/health)
│   │   ├── brain-io.mjs                     # Read/write JSONL with lock wrapper
│   │   ├── audit-trail.mjs                  # Append-only observation history
│   │   ├── branch-context.mjs               # Git branch detection + filter
│   │   ├── gitnexus-runner.mjs              # Subprocess runner for GitNexus CLI
│   │   ├── brain-health-checks.mjs          # 5 health check implementations
│   │   ├── embedding-service.mjs            # Embedding generation (Hugging Face ONNX)
│   │   ├── semantic-search.mjs              # Hybrid search (semantic + keyword)
│   │   ├── file-lock.mjs                    # Cross-process file locking
│   │   ├── skill-adapters.mjs               # Agent configs + transforms (Claude/Cursor/Gemini/Codex)
│   │   ├── skill-export.mjs                 # Export engine (discover, compat check, write strategies)
│   │   ├── skills-module.mjs                # MCP tools (hermit_skill_list + hermit_skill_export)
│   │   ├── parse-observation.mjs            # Observation parsing utility
│   │   └── resolve-brain-path.mjs           # Brain path resolver
│   │
│   ├── hermit-mcp-server.mjs           # MCP server entry point (v4) — loads 4 modules
│   ├── migrate-v3-to-v4.mjs            # Migration script (v3 → v4 data format)
│   ├── test-v4.mjs                     # 36 v4 test cases
│   ├── brain-cli.mjs                   # Unified CLI (backward compat)
│   ├── build-embedding-index.mjs       # Index builder
│   ├── merge-brain-jsonl.mjs           # Git merge driver
│   ├── brain-health.mjs                # Health check script (uses brain-health-checks.mjs)
│   ├── setup-project.mjs               # Project initialization (updated for v4)
│   ├── setup-semantic.mjs              # Semantic setup
│   ├── sync-to-neo4j.mjs               # Neo4j synchronizer
│   ├── stale-report.mjs               # Stale observation report
│   ├── backfill-confidence.mjs        # Add confidence prefix to legacy data
│   └── export-db-to-jsonl.mjs         # Export DB to JSONL
│
├── viewer/
│   ├── index.html                      # Dashboard UI (enhanced in v3)
│   ├── data.json                       # Static data source (for development)
│   └── [CSS/JS assets]
│
├── docs/
│   ├── system-architecture.md          # Architecture (v3 updated)
│   ├── codebase-summary.md             # This file
│   ├── project-changelog.md            # Changelog (v3 entry added)
│   ├── development-roadmap.md          # Roadmap (v3 marked complete)
│   ├── gitnexus-*.md                   # GitNexus integration docs
│   └── [other docs]
│
├── .gitattributes                      # Git merge driver config
├── package.json                        # npm config + brain CLI bin (v4)
├── README.md                           # Project introduction
└── CLAUDE.md                           # Claude Code instructions

```

---

## Core Modules (v4)

### MCP Server Entry & Modules
| Module | Purpose | Tools |
|--------|---------|-------|
| `hermit-mcp-server.mjs` | Unified server entry point | Loads 4 modules via `register()` pattern |
| `scripts/lib/memory-module.mjs` | KG CRUD operations | 10 tools (create/search/get/update/delete/export/etc) |
| `scripts/lib/codegraph-module.mjs` | GitNexus wrapper | 4 tools (query/context/impact/detect-changes) |
| `scripts/lib/intelligence-module.mjs` | Audit + consolidation | 3 tools (audit-trail/consolidate/branch-context) |
| `scripts/lib/unified-search.mjs` | Cross-module search | 2 tools (unified-search/health) |
| `scripts/lib/skills-module.mjs` | Skill distribution | 2 tools (skill-list/skill-export) |

### Supporting Libraries
| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `scripts/lib/brain-io.mjs` | Read/write JSONL with locking | `readBrain()`, `writeBrain()`, `withBrainLock()` |
| `scripts/lib/audit-trail.mjs` | Append-only history | `getEntityHistory()`, `archiveObservation()` |
| `scripts/lib/branch-context.mjs` | Git branch detection | `detectBranch()`, `getBranchFilter()`, `setBranchFilter()` |
| `scripts/lib/gitnexus-runner.mjs` | CLI subprocess wrapper | `runGitNexus()` (30s timeout, JSON parsing) |
| `scripts/lib/brain-health-checks.mjs` | Health check logic | `checkStale()`, `checkDuplicates()`, `checkOrphans()`, etc. |
| `scripts/lib/embedding-service.mjs` | ONNX embeddings | `embed()`, `embedBatch()`, `isAvailable()` |
| `scripts/lib/semantic-search.mjs` | Hybrid search | `search()` (0.7 semantic + 0.3 keyword) |
| `scripts/lib/file-lock.mjs` | Cross-process sync | `withLock()`, `acquireLock()`, `releaseLock()` |
| `scripts/lib/skill-adapters.mjs` | Agent configs + transforms | `AGENTS`, `parseFrontmatter()` |
| `scripts/lib/skill-export.mjs` | Export engine | `discoverSkills()`, `exportSkill()`, `exportAll()`, `checkCompat()` |
| `scripts/lib/parse-observation.mjs` | Observation parsing | `parseObservation()`, `obsText()` |

### CLI & Utility Scripts
| Script | Purpose | Command |
|--------|---------|---------|
| `scripts/brain-cli.mjs` | Unified CLI (backward compat) | `hermit search`, `hermit health`, `hermit index`, etc. |
| `scripts/skills-manager.mjs` | Skill install/remove/export | `hermit skills [list\|add\|remove\|export]` |
| `scripts/migrate-v3-to-v4.mjs` | Data migration | `node scripts/migrate-v3-to-v4.mjs` |
| `scripts/setup-project.mjs` | Project init (updated for v4) | `npm run setup:all` |
| `scripts/brain-health.mjs` | Health check (uses health-checks.mjs) | `brain health` |
| `scripts/merge-brain-jsonl.mjs` | Git merge driver | Auto-invoked by git merge |

### UI
| File | Purpose |
|------|---------|
| `viewer/index.html` | Web dashboard (entity browser, search, stale indicators) |

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
npm test                 # Run unit tests
node scripts/test-v3-comprehensive.mjs  # Test v3 features
```

---

## Dependencies (v4)

```json
{
  "@modelcontextprotocol/sdk": "^1.29.0", // MCP server framework
  "@huggingface/transformers": "^4.0.1",  // ONNX embeddings (Xenova/all-MiniLM-L6-v2)
  "zod": "^3.x",                          // Tool parameter validation
  "neo4j-driver": "^5.27.0",              // Graph database (optional)
  "dotenv": "^16.4.0"                     // Environment config
}
```

## v3 → v4 Migration

**Data Format Change:**
Old: Simple string observations
New: Object observations with `content`, `_branch`, `_archived`, `_archivedAt`, `_history[]` fields

**Server Change:**
Old: Two separate MCP servers (launch-memory-mcp.mjs, launch-conventions-mcp.mjs)
New: Single unified server (hermit-mcp-server.mjs) with 4 registered modules

**Run migration script before using v4 MCP:**
```bash
node scripts/migrate-v3-to-v4.mjs
```

Maps old brain.jsonl entities to v4 format (preserves all observations).

---

## v4 Changes (Latest)

| Component | Change | Status |
|-----------|--------|--------|
| MCP Server | Unified hermit-mcp-server.mjs (19 tools, 4 modules) | Complete |
| Memory Module | 10 KG CRUD tools (replaces launch-memory-mcp.mjs) | Complete |
| CodeGraph Module | 4 GitNexus tools (query/context/impact/detect-changes) | Complete |
| Intelligence Module | 3 tools (audit-trail/consolidate/branch-context) | Complete |
| Brain I/O | Refactored read/write with explicit locking interface | Complete |
| Audit Trail | Append-only observation history tracking | Complete |
| Health Checks | 5 automated checks, refactored to reusable module | Complete |
| Migration Script | migrate-v3-to-v4.mjs for data format upgrade | Complete |
| Tests | 36 comprehensive v4 test cases (test-v4.mjs) | Complete |
| Setup | Updated for v4 MCP config in .claude-settings.json | Complete |
| Skills Module | 2 MCP tools (hermit_skill_list/hermit_skill_export) | Complete |
| Skill Adapters | 4 agent configs (Claude/Cursor/Gemini/Codex) + transforms | Complete |
| Skill Export Engine | Discover, compat check, per-file + merge-single write | Complete |
| CLI Export | `hermit skills export` subcommand with --agent/--project/--global | Complete |

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
- `node_modules/` — npm dependencies

---

## Performance Notes

- **Embedding model:** ~23 MB (ONNX, downloaded once and cached)
- **Search latency:** <100ms for 1K entities (hybrid scoring)
- **JSONL append:** <10ms per entity (lock-free reads)
- **Embedding rebuild:** ~5-10s for 5K entities (one-time or periodic)

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
- Neo4j sync status

### Stale Report
```bash
brain stale
```

Shows observations not updated in >180 days.

---

## Future Enhancements

- [ ] Real-time Neo4j event streaming
- [ ] Full-text search indices
- [ ] Multi-model embedding support (domain-specific)
- [ ] Advanced graph analytics
- [ ] Web UI for entity editing
