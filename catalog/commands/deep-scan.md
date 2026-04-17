---
description: Full project scan cho KG
context: fork
---

# Deep Scan — Full Project Mastery

Scan current project to build comprehensive KG knowledge.
Goal: Know this project like a senior dev + BA who's been here for years.
After scan, Claude can code with full context: architecture, business rules, patterns, impact awareness.

## Input
$ARGUMENTS — project path or name [--force for full rescan]
Examples: `/deep-scan`, `/deep-scan D:\discord`, `/deep-scan --force`, `/deep-scan D:\discord --force`

---

## Observation Lifecycle Protocol

**On first scan (no ScanMeta found):** skip this protocol — use `create_entities` directly.

**On incremental scan:** before saving entities in any phase, follow this protocol:

1. `search_nodes("{entity_name}")` → get existing entity
2. If entity exists → compare observations:
   - Extract PREFIX from each observation (text between `] ` and first `:` after confidence tag, e.g., `STACK`, `NAMING`, `RULE`)
   - For each new observation:
     a. Find existing observation with same PREFIX
     b. Same PREFIX + same content → **skip** (no duplicate)
     c. Same PREFIX + different content → `delete_observations` old, `add_observations` new
     d. No matching PREFIX → `add_observations` (new fact)
   - For unmatched existing observations:
     a. Parse date from `[conf|YYYY-MM-DD]`
     b. If >180 days old → `add_observations("[STALE] " + original text)` to flag review
     c. If ≤180 days → keep as-is (may still be valid, just not re-scanned this run)
3. If entity doesn't exist → `create_entities` as normal

---

## Phase 0: Smart Change Detection

### Step 0: Use hermit_deep_scan tool (if available)
- Call `hermit_deep_scan({cwd: "{project_path}", force: {true|false}})` for fast Phase 0-3
- If tool returns structured data → skip to Phase 4 with returned identity/architecture/apiSurface data
- If tool returns "no-changes" → stop (or use --force)
- If tool is unavailable or errors → fall through to manual Phase 0 below

### Step 1: Parse arguments
- Extract project path from $ARGUMENTS (default: current working directory)
- Check if `--force` flag present → if yes, set `SCAN_TYPE = full`, skip to Step 5

### Step 2: Detect project name
- From `package.json` → `name` field, or `pyproject.toml` → `[project] name`, or top-level directory name

### Step 3: Check ScanMeta
- `search_nodes("TECH:{ProjectName}:ScanMeta")` → look for existing scan state
- If NOT found → first scan: set `SCAN_TYPE = full`, skip to Step 5
- If found → extract `LAST_SCAN` date, `GIT_HEAD`, `ALL_DIRS` file counts

### Step 4: Detect changes since last scan

**For git repos** (`.git` directory exists):
```bash
git log --since="{LAST_SCAN}" --stat --pretty=format:"%H"
```
Map changed files to affected phases using this table:

| Changed file pattern | Affected phases |
|---------------------|-----------------|
| `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml` | Phase 1 |
| `README.md`, `CLAUDE.md`, `AGENTS.md` | Phase 1 |
| `docker-compose*`, `.github/workflows/*`, `Makefile` | Phase 1 |
| Directory structure added/removed | Phase 2 |
| `routes/`, `controllers/`, `api/`, `pages/`, `app/api/` | Phase 3 |
| `src/`, `lib/`, `app/` (content changes) | Phase 4, 5 |
| `*.env*`, `docker*`, `webhook*`, `queue*`, SDK init files | Phase 6 |

Also check if git HEAD matches stored `GIT_HEAD` — if not (rebase/force-push), set `SCAN_TYPE = full`.

**For non-git dirs (and always for data/content dirs even in git repos):**
- List ALL directories (1 level deep), count files per dir recursively
- Compare against ScanMeta `ALL_DIRS` observations
- Detect: new dirs, removed dirs, file count changes in any dir
- Map dir changes to phases:

| Changed dir pattern | Affected phases |
|---------------------|-----------------|
| `src/`, `lib/`, `app/` | Phase 2, 4, 5 |
| `routes/`, `controllers/`, `api/` | Phase 3 |
| `plans/`, `docs/`, `reports/` | Phase 1, 5 (may contain business context) |
| Data output dirs (see Phase 1.5 patterns) | Phase 1.5 |
| `scripts/`, config dirs | Phase 1, 6 |
| Any new dir not in ScanMeta | Phase 1 (re-evaluate structure) |
| Root-level files (count change) | Phase 1 |

**Decision:**
- No changes in any phase → output: `"No changes since {LAST_SCAN}. Use --force for full rescan."` → **STOP**
- Changes found → set `SCAN_TYPE = incremental`, `PHASES_TO_RUN = {list of affected phases}`

### Step 5: Set scan plan
- `SCAN_TYPE = full` → run ALL phases (0 through 8)
- `SCAN_TYPE = incremental` → run only `PHASES_TO_RUN` + always run Phase 7 (relations) + Phase 7.5 (ScanMeta) + Phase 8 (summary)
- Log: `"Scan type: {full|incremental} — Phases: {list}"`

---

## Phase 1: Project Identity

**Skip if** not in `PHASES_TO_RUN` (incremental mode).

**Scan these files** (read all that exist):
- `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `pom.xml`
- `README.md` / `CLAUDE.md` / `AGENTS.md`
- `.env.example` / `.env.sample`
- `docker-compose.yml` / `docker-compose.yaml`
- `.github/workflows/*.yml` / `.gitlab-ci.yml`
- `Makefile` / `justfile`

**Extract & save** (follow **Observation Lifecycle Protocol**):
```
Entity: "BIZ:{ProjectName}" (biz-domain)
Observations:
  [0.95|{date}] WHAT: {one-line description}
  [0.95|{date}] STACK: {frontend framework} + {backend framework} + {database}
  [0.9|{date}] REPO: {monorepo/single-app}, {language}, {package manager}
  [0.9|{date}] STRUCTURE: {key directories and their purpose}
  [0.8|{date}] SCRIPTS: {key npm/make scripts — dev, build, test, deploy}
  [0.8|{date}] CI_CD: {pipeline tool and key steps}
  [0.8|{date}] DOCKER: {services, ports, dependencies}
  [0.8|{date}] ENV_VARS: {list required env vars from .env.example}
```

Also create `TECH:{ProjectName}` (tech-stack) with detailed dependency breakdown.

---

## Phase 1.5: Data Output Scanning

**Always runs** if data output directories are detected (not gated by `PHASES_TO_RUN`).

### Step 1: Detect data output directories
List all directories in project root. Match against these patterns:
- `*-txt/` — converted docs (e.g., delivery-txt/, management-txt/)
- `*-exports/` — exported files (e.g., gdrive-exports/)
- `trimmed/` — processed/cleaned data
- `*-dump*/` — raw dumps (e.g., thread-raw-dump-2026-03-20/)
- `output/`, `data/`, `exports/` — generic output dirs
- `plans/`, `docs/`, `reports/` — project documentation and decisions

**Filter:** only detect dirs with ≥5 files of same type. Ignore `node_modules/`, `.git/`, `dist/`, `build/`.

### Step 2: Classify corpus type

| Signal | Corpus Type | Read Strategy |
|--------|------------|---------------|
| `.md` files with `**username** ·` pattern | Discord trimmed | Full file (small after trim) |
| `.md` files with `dump_json:` or ` ```json ` | Discord raw | Header + first 50 messages |
| `.txt` files (from converted docs) | Converted docs | First 150 lines |
| `.csv` files | Sheet exports | Header + 10 rows |
| `.json` files (array or object) | JSON data | Structure + 3 sample items |
| `.log` files | Logs | First 50 + last 50 lines |

### Step 3: Sample files
- Pick 5–10 representative files (spread across subdirs)
- For dirs with 100+ files → random sample, ensure spread
- **Hard cap:** 150 lines per file, 10 files max total
- **Incremental:** compare file count vs ScanMeta `ALL_DIRS` → only read new files

### Step 4: Extract business context

**Follow Observation Lifecycle Protocol.** Confidence cap: 0.7 for all data-derived observations.

**Corpus overview:**
```
Entity: "ENTITY:{ProjectName}:DataCorpus" (biz-entity)
Observations:
  [0.7|{date}] CORPUS: {N} files in {dirs}, covering {date range if detectable}
  [0.7|{date}] CHANNELS: {list Discord channels/thread names if applicable}
  [0.7|{date}] VOLUME: {N} threads, {M} docs, etc.
  [0.6|{date}] SAMPLE: {N}/{total} files sampled — inferred from data sampling
```

**People/team** (only if usernames appear ≥3 times across samples):
```
Entity: "TECH:{ProjectName}:Team" (tech-person)
Observations:
  [0.7|{date}] MEMBER:{username} — {role if detectable}, frequency: {high/medium/low}
  [0.6|{date}] NOTE: extracted from {N} sampled files — inferred from data sampling
```

**Topics/themes** (only if topic appears in ≥2 sampled files):
```
Entity: "ENTITY:{ProjectName}:{TopicName}" (biz-entity)
Observations:
  [0.6|{date}] WHAT: {description} — inferred from data sampling
  [0.6|{date}] CONTEXT: appears in {thread/channel/file names}
  [0.6|{date}] KEY_POINTS: {bullet points from content}
```

**Decisions/rules found in content** (only if explicitly stated):
```
Entity: "RULE:{ProjectName}:{RuleName}" (biz-rule)
Observations:
  [0.65|{date}] RULE: {description} — inferred from data sampling, verify with team
  [0.65|{date}] SOURCE: {thread/doc name where found}
```

### Step 5: Relations
```
BIZ:{Project} → has_data → ENTITY:{Project}:DataCorpus
ENTITY:{Project}:DataCorpus → mentions → TECH:{Project}:Team
ENTITY:{Project}:DataCorpus → contains → ENTITY:{Project}:{Topic}
```

---

## Phase 2: Architecture Mapping

**Skip if** not in `PHASES_TO_RUN` (incremental mode).

**Scan:**
- Directory structure (`ls` top 2 levels)
- Entry points: `main.*`, `app.*`, `index.*`, `server.*`
- Config files: `tsconfig.json`, `.eslintrc.*`, `biome.json`, `.prettierrc`
- Routing: look for `routes/`, `router/`, `controllers/`, `pages/`, `app/api/`

**Launch 1-2 Explore subagents** to scan directory structure and entry points in parallel.

**Extract & save** (follow **Observation Lifecycle Protocol**):
```
Entity: "PATTERN:ARCH:{ProjectName}:Architecture" (pattern-arch)
Observations:
  [0.9|{date}] LAYERS: {e.g., Controller → Service → Repository → DB}
  [0.9|{date}] ENTRY_POINTS: {list main entry files}
  [0.9|{date}] MODULES: {list top-level modules/domains}
  [0.8|{date}] MIDDLEWARE: {auth, logging, error handling chain}
  [0.8|{date}] SHARED: {shared utilities, common helpers, base classes}
```

Create relation: `BIZ:{ProjectName}` → `uses` → `PATTERN:ARCH:{ProjectName}:Architecture`

---

## Phase 3: API Surface & Data Models

**Skip if** not in `PHASES_TO_RUN` (incremental mode).

**Scan:**
- Route/controller files → list all endpoints (METHOD /path)
- ORM models / schema files (`.prisma`, `*.model.*`, `models/`, `entities/`, `schema.*`)
- Migration files → table creation, column changes
- Type definitions / DTOs / validators

**Launch 1-2 Explore subagents** to scan routes and models in parallel.

**Extract & save** (follow **Observation Lifecycle Protocol**):

**API Routes:**
```
Entity: "PATTERN:ARCH:{ProjectName}:APIRoutes" (pattern-arch)
Observations:
  [0.9|{date}] TOTAL: ~{N} endpoints
  [0.9|{date}] {domain1}/: {list endpoints — GET /users, POST /users, etc.}
  [0.9|{date}] {domain2}/: {list endpoints}
  [0.8|{date}] AUTH: {which endpoints require auth, which are public}
  [0.8|{date}] PATTERNS: {response format, pagination style, error format}
```

**Data Models:**
```
Entity: "ENTITY:{ProjectName}:DataModels" (biz-entity)
Observations:
  [0.9|{date}] TABLE:{name} — {columns summary, PKs, FKs}
  // one observation per table/model
  [0.8|{date}] RELATIONS: {FK chains — order→user, orderItem→product}
  [0.8|{date}] STATE_MACHINES: {entity: states and transitions}
  [0.8|{date}] SOFT_DELETE: {pattern if any — deletedAt, isDeleted, status}
```

Create relations: `BIZ:{ProjectName}` → `has_data_model` → `ENTITY:{ProjectName}:DataModels`

---

## Phase 4: Code Patterns & Conventions

**Skip if** not in `PHASES_TO_RUN` (incremental mode).

**Scan 20+ source files** for:
- Naming convention (camelCase vs snake_case vs PascalCase)
- Import style (ESM vs CJS vs mixed)
- Error handling pattern (try-catch, Result<T>, error middleware)
- Auth pattern (JWT, session, OAuth — where check lives)
- Component structure (functional vs class, hooks pattern)
- State management (Redux, Zuex, Context, Zustand, signals)
- API call pattern (fetch, axios, tRPC, GraphQL client)

**Extract & save** (follow **Observation Lifecycle Protocol**):
```
Entity: "PATTERN:ARCH:{ProjectName}:Conventions" (pattern-arch)
Observations:
  [{conf}|{date}] NAMING: {convention with examples}
  [{conf}|{date}] IMPORTS: {ESM/CJS, barrel exports?}
  [{conf}|{date}] ERROR_HANDLING: {pattern — how errors propagate}
  [{conf}|{date}] AUTH: {where auth check lives, token format, roles}
  [{conf}|{date}] COMPONENTS: {pattern with example structure}
  [{conf}|{date}] STATE: {state management approach}
  [{conf}|{date}] API_CALLS: {how frontend calls backend}
  [{conf}|{date}] LINTING: {eslint/prettier/biome config summary}
```

Confidence: >80% occurrence = 0.9, 60-80% = 0.7, <60% = 0.5

---

## Phase 5: Business Logic Extraction

**Skip if** not in `PHASES_TO_RUN` (incremental mode).

**Scan:**
- Service layer files (`*.service.*`, `services/`, `usecases/`, `domain/`)
- Validation files (`*.dto.*`, `*.schema.*`, `validators/`, `*.validator.*`)
- Constants / enum files
- Policy / permission files
- BUSINESS.md if exists
- Test descriptions (`it('should...', ...)` / `test('...',)` — extract behavioral specs)
- Important comments (`// BUSINESS RULE:`, `// IMPORTANT:`, `// RULE:`, `// CONSTRAINT:`)

**Extract & save** (follow **Observation Lifecycle Protocol**) — one entity per discovered rule:
```
Entity: "RULE:{ProjectName}:{RuleName}" (biz-rule)
Observations:
  [0.8|{date}] RULE: {description}
  [0.8|{date}] CONTEXT: {when/where this applies}
  [0.8|{date}] VIOLATION: {what happens when violated — error msg, status code}
  [0.8|{date}] FILES: {where implemented — service.ts:L42, validator.ts:L15}
```

**Extract flows** — one entity per discovered flow:
```
Entity: "FLOW:{ProjectName}:{FlowName}" (biz-flow)
Observations:
  [0.8|{date}] FLOW: {step1 → step2 → step3}
  [0.8|{date}] TRIGGER: {what starts this flow}
  [0.8|{date}] SIDE_EFFECTS: {emails, notifications, webhooks triggered}
  [0.8|{date}] EDGE_CASES: {known edge cases handled}
```

---

## Phase 6: Integration & Config

**Skip if** not in `PHASES_TO_RUN` (incremental mode).

**Scan:**
- HTTP client calls (`axios`, `fetch`, `requests`, `httpClient`)
- Webhook handlers (routes named `/webhook*`, `/callback*`)
- Queue producers/consumers (kafka, rabbitmq, sqs, bullmq patterns)
- Cron jobs / scheduled tasks
- 3rd party SDK init files
- All env vars used in code (cross-ref with .env.example)

**Extract & save** (follow **Observation Lifecycle Protocol**):
```
Entity: "PATTERN:INT:{ProjectName}:{ServiceName}" (pattern-integration)
Observations:
  [0.8|{date}] SERVICE: {name and purpose}
  [0.8|{date}] PROTOCOL: {REST/GraphQL/gRPC/WebSocket/Queue}
  [0.8|{date}] AUTH: {API key / OAuth / JWT}
  [0.8|{date}] ENDPOINTS_USED: {list key endpoints called}
  [0.8|{date}] ERROR_HANDLING: {retry logic, fallback, circuit breaker}
```

---

## Phase 7: Impact Relations

**Always runs** (even in incremental — relations may need updating).

After all entities created/updated, build cross-references:

```
create_relations([
  // Architecture
  {from: "BIZ:{Project}", to: "PATTERN:ARCH:{Project}:Architecture", relationType: "uses"},
  {from: "BIZ:{Project}", to: "PATTERN:ARCH:{Project}:Conventions", relationType: "uses"},
  {from: "BIZ:{Project}", to: "PATTERN:ARCH:{Project}:APIRoutes", relationType: "has_architecture"},
  {from: "BIZ:{Project}", to: "ENTITY:{Project}:DataModels", relationType: "has_data_model"},

  // Data output
  {from: "BIZ:{Project}", to: "ENTITY:{Project}:DataCorpus", relationType: "has_data"},

  // Rules → Flows
  {from: "RULE:{Project}:{Rule}", to: "FLOW:{Project}:{Flow}", relationType: "affects"},

  // Integrations
  {from: "BIZ:{Project}", to: "PATTERN:INT:{Project}:{Service}", relationType: "integrates_with"},

  // Tech
  {from: "BIZ:{Project}", to: "TECH:{Project}", relationType: "built_with"}
])
```

---

## Phase 7.5: Save ScanMeta

**Always runs** — saves scan state for future incremental detection.

**Follow Observation Lifecycle Protocol** (ScanMeta itself gets deduped on rescan).

```
Entity: "TECH:{ProjectName}:ScanMeta" (tech-config)
Observations:
  [0.95|{date}] LAST_SCAN: {ISO datetime}
  [0.95|{date}] PHASES_RUN: {comma-separated list of phases that ran}
  [0.9|{date}] GIT_HEAD: {current commit hash, or "non-git" if no .git}
  [0.8|{date}] ALL_DIRS: {dir_name/(file_count) for each data dir found}
  [0.8|{date}] SCAN_TYPE: {full|incremental}
  [0.8|{date}] FILES_SCANNED: {total files read across all phases}
```

---

## Phase 7.75: Generate / Update BUSINESS.md

**Always runs** after Phase 5+ completes (needs business data from KG).

This phase writes a real BUSINESS.md file at the project root using entities gathered during the scan. If the file already exists, **overwrite it** with fresh data — the KG is the source of truth.

### Step 1: Collect KG entities for this project

Gather all entities created/updated during this scan:
- `BIZ:{ProjectName}` → domain description, tech stack
- `ENTITY:{ProjectName}:DataModels` → core entities/tables
- `RULE:{ProjectName}:*` → all business rules
- `FLOW:{ProjectName}:*` → all business flows
- `PATTERN:ARCH:{ProjectName}:Architecture` → layers, entry points
- `PATTERN:INT:{ProjectName}:*` → external integrations

Use `search_nodes("{ProjectName}")` to find all relevant entities.

### Step 2: Write BUSINESS.md

Use the **Write tool** to create/overwrite `{projectRoot}/BUSINESS.md` with this structure:

```markdown
# BUSINESS.md — Business Impact Map

> ⚠️ AI Agent: ĐỌC FILE NÀY TRƯỚC KHI SỬA BẤT KỲ BUSINESS LOGIC NÀO
> Sửa 1 chỗ có thể ảnh hưởng nhiều chỗ khác. Kiểm tra impact chain TRƯỚC khi code.
> Auto-generated by /deep-scan on {date}. Source of truth: Knowledge Graph.

## Domain
{from BIZ:{ProjectName} WHAT: observation}

## Tech Stack
{from BIZ:{ProjectName} STACK: observation — expand into bullet list}
- Language: {lang}
- Frontend: {frontend}
- Backend: {backend}
- Database: {db}
- Build Tools: {build}
- Infrastructure: {infra}

## Core Entities
| Entity | Mô tả | File chính |
|--------|--------|------------|
{for each TABLE: observation in ENTITY:{ProjectName}:DataModels → one row}

## 🔴 High-Impact Chains
{for each FLOW:{ProjectName}:* entity:}
### Chain: {FlowName}
> {FLOW: observation — step1 → step2 → step3}
- Trigger: {TRIGGER: observation}
- Side effects: {SIDE_EFFECTS: observation}
- Edge cases: {EDGE_CASES: observation}

## 📋 Business Rules (KHÔNG ĐƯỢC PHÁ VỠ)
{for each RULE:{ProjectName}:* entity:}
### {RuleName}
- Rule: {RULE: observation}
- Context: {CONTEXT: observation}
- Violation: {VIOLATION: observation}
- Files: {FILES: observation}

## 🔄 External Integrations
{for each PATTERN:INT:{ProjectName}:* entity:}
### {ServiceName}
- Protocol: {PROTOCOL: observation}
- Auth: {AUTH: observation}
- Endpoints: {ENDPOINTS_USED: observation}

## 📝 Lessons Learned
> Thêm vào đây mỗi khi phát hiện impact mới hoặc bug do biz logic
{search for INCIDENT:{ProjectName}:* — list any found, else leave empty}
```

### Rules for this phase
- **Always overwrite** — BUSINESS.md is generated output, KG is source of truth
- **Skip empty sections** — if no rules found, omit the Business Rules section entirely
- **Preserve user additions** — if existing BUSINESS.md has a `## 📝 Lessons Learned` section with manual entries, append them to the new file
- **Keep concise** — one line per rule/flow/entity, no verbose descriptions

---

## Phase 8: Summary Report

Output markdown summary:

```
## Deep Scan Complete: {ProjectName}

### Scan Info
- Type: {full|incremental}
- Phases run: {list}
- Trigger: {first scan | --force | changes in: X, Y, Z}

### Stats
| Tier | Entities Created | Entities Updated | Observations |
|------|-----------------|-----------------|--------------|
| BIZ | {n} | {n} | {n} |
| PATTERN | {n} | {n} | {n} |
| TECH | {n} | {n} | {n} |
| INCIDENT | {n} | {n} | {n} |
| **Total** | {N} | {N} | {N} |

Relations created: {N}

### Key Findings
- Architecture: {one-line summary}
- Tech stack: {one-line summary}
- API surface: {N} endpoints across {M} domains
- Data models: {N} tables/models
- Business rules: {N} rules discovered
- Integrations: {N} external services
- Conventions: {list key conventions}
- Data corpus: {N} data dirs, {M} files sampled (if Phase 1.5 ran)

### Impact-Ready
These relations enable `/impact` to trace changes:
- {N} rule → flow connections
- {N} integration dependencies
- {N} architecture patterns

### Gaps / Manual Review Needed
- {list areas where confidence < 0.7}
- {list areas that need human confirmation}
- {list [STALE] observations flagged for review}
```

---

## Rules

1. **search_nodes FIRST** — always check before creating to avoid duplicates
2. **Observation Lifecycle** — on incremental scans, follow the Protocol (dedup, update, stale-flag)
3. **Observations have prefix** — `[confidence|YYYY-MM-DD]` on every observation
4. **One entity per concept** — don't merge multiple rules/flows into one entity
5. **Progressive save** — save after each phase (don't batch everything at end)
6. **Confidence calibration** — code/config = 0.9, README/comments = 0.8, inferred patterns = 0.6, data output = 0.7 max
7. **Preserve terminology** — use project's own naming (don't rename/translate)
8. **Note uncertainties** — if something looks like a business rule but isn't confirmed, flag it
9. **Context-aware** — if running out of context, prioritize Phase 0-3 (highest value)
10. **Data output cap** — max 10 files sampled, 150 lines/file, confidence ≤0.7, always note "inferred from data sampling"
