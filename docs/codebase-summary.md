# Codebase Summary — hermit-graph

## Quick Overview

**hermit-graph** is a knowledge graph system for capturing and retrieving project intelligence across development sessions. Built on JSONL + semantic embeddings (v3), with Neo4j optional sync and custom git merge support.

**Repository root:** `/`
**Primary language:** JavaScript (Node.js)
**Package manager:** npm

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
│   │   ├── embedding-service.mjs       # Embedding generation (Hugging Face)
│   │   ├── semantic-search.mjs         # Hybrid search (semantic + keyword)
│   │   ├── file-lock.mjs               # Cross-process file locking
│   │   ├── parse-observation.mjs       # Observation parsing utility
│   │   └── [others]
│   │
│   ├── brain-cli.mjs                   # Unified CLI entry point (v3)
│   ├── build-embedding-index.mjs       # Index builder (v3)
│   ├── merge-brain-jsonl.mjs           # Git merge driver (v3)
│   ├── brain-health.mjs                # Health check script
│   ├── sync-to-neo4j.mjs               # Neo4j synchronizer
│   ├── stale-report.mjs                # Stale observation reporter
│   ├── export-db-to-jsonl.mjs          # MCP DB exporter
│   ├── launch-memory-mcp.mjs           # Memory MCP server
│   ├── launch-conventions-mcp.mjs      # Conventions MCP server
│   ├── setup-project.mjs               # Project initialization
│   ├── setup-semantic.mjs              # Semantic setup
│   ├── backfill-confidence.mjs         # Confidence backfiller
│   ├── migrate-brain-v1-to-v2.mjs      # Migration script
│   ├── test.mjs                        # Unit tests
│   └── test-v3-comprehensive.mjs       # v3 feature tests
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
├── .gitattributes                      # Git merge driver config (v3)
├── package.json                        # npm config + brain CLI bin (v3)
├── README.md                           # Project introduction
└── CLAUDE.md                           # Claude Code instructions

```

---

## Core Modules (v3)

### Data Access
| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `scripts/lib/embedding-service.mjs` | Semantic embeddings (ONNX) | `embed()`, `embedBatch()`, `isAvailable()` |
| `scripts/lib/semantic-search.mjs` | Hybrid search engine | `search()`, `prepareIndex()` |
| `scripts/lib/file-lock.mjs` | Cross-process sync | `acquireLock()`, `releaseLock()` |
| `scripts/lib/parse-observation.mjs` | Observation parsing | `parseObservation()` |

### CLI & Scripts
| Script | Purpose | Command |
|--------|---------|---------|
| `scripts/brain-cli.mjs` | Unified CLI | `brain search`, `brain health`, `brain index`, etc. |
| `scripts/build-embedding-index.mjs` | Index builder | `npm run build:index` |
| `scripts/merge-brain-jsonl.mjs` | Git merge driver | Auto-invoked by git merge |
| `scripts/brain-health.mjs` | Health check | `brain health` |
| `scripts/sync-to-neo4j.mjs` | Neo4j sync | `npm run sync` |
| `scripts/stale-report.mjs` | Stale node reporter | `brain stale` |
| `scripts/export-db-to-jsonl.mjs` | MCP export | `brain export` |

### MCP Servers
| Server | Purpose |
|--------|---------|
| `scripts/launch-memory-mcp.mjs` | Claude search/recall interface |
| `scripts/launch-conventions-mcp.mjs` | Convention management |

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

## Dependencies

```json
{
  "@huggingface/transformers": "^4.0.1",  // ONNX embeddings
  "neo4j-driver": "^5.27.0",              // Graph database (optional)
  "dotenv": "^16.4.0"                     // Environment config
}
```

---

## v3 Changes (Latest)

| Component | Change | Status |
|-----------|--------|--------|
| Embedding Service | New ONNX-based semantic search module | Complete |
| File Locking | Cross-process synchronization for brain.jsonl | Complete |
| Git Merge Driver | Entity-level 3-way merge strategy | Complete |
| Brain CLI | Unified command-line interface | Complete |
| Dashboard | Enhanced search + stale node indicators | Complete |
| Package.json | Added `bin` field for brain CLI | Complete |

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
