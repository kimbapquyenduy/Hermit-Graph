# System Architecture — hermit-graph

## Overview

hermit-graph is a distributed knowledge graph system for AI-assisted development. It captures, organizes, and retrieves project intelligence (architecture decisions, code patterns, business rules, incidents) across development sessions.

**Core technology:** JSONL-based knowledge graph + Neo4j sync + semantic embeddings (v3+)

---

## Architecture Layers

### 1. Data Layer

#### Brain JSONL (Single Source of Truth)
- **File:** `data/brain.jsonl`
- **Format:** Newline-delimited JSON entities
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

### 5. MCP Integration Layer

#### Memory MCP Server (`scripts/launch-memory-mcp.mjs`)
- **Role:** Provides Claude with search + recall capabilities
- **Exports:**
  - `search_nodes(query)` — Find entities by keyword
  - `read_graph(options)` — Read full/partial graph
  - `open_nodes(names)` — Get details on specific entities
  - `get_entity_details(names)` — Detailed view with all observations
- **Data source:** brain.jsonl + file locking
- **Concurrency:** Safe multi-client access via file lock service

#### Conventions MCP Server (`scripts/launch-conventions-mcp.mjs`)
- **Role:** Manages project conventions and standards
- **Data store:** `data/conventions/`
- **Purpose:** Encode project-specific rules (naming, patterns, deployment)

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

## API Contracts

### Embedding Service
```typescript
embed(text: string): Promise<Float32Array | null>
embedBatch(texts: string[]): Promise<Float32Array[] | null>
isAvailable(): Promise<boolean>
```

### Semantic Search
```typescript
search(query: string, options?: {
  maxResults?: number,
  entityType?: string,
  minConfidence?: number
}): Promise<SearchResult[]>
```

### File Lock
```typescript
acquireLock(filepath: string, timeout?: number): Promise<LockHandle>
releaseLock(handle: LockHandle): Promise<void>
```

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @huggingface/transformers | ^4.0.1 | Semantic embeddings (ONNX) |
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
