<p align="center">
  <img src="https://raw.githubusercontent.com/kimbapquyenduy/hermit-graph/main/assets/brand/og-image-hermit-graph-1200x630.png" alt="Hermit Graph" width="600" />
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/hermit-graph?style=flat-square&color=blue" alt="npm version" />
  <img src="https://img.shields.io/npm/dw/hermit-graph?style=flat-square&color=blue" alt="npm downloads" />
  <img src="https://img.shields.io/github/stars/kimbapquyenduy/hermit-graph?style=flat-square&logo=github" alt="GitHub stars" />
  <img src="https://img.shields.io/badge/agents-Claude%20%7C%20Cursor%20%7C%20Gemini%20%7C%20Windsurf%20%7C%20Cline%20%7C%20Codex%20%7C%20OpenCode-blueviolet?style=flat-square" alt="Supported agents" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/MCP-v1.29-orange?style=flat-square" alt="MCP Protocol" />
</p>

# Hermit Graph

**Your AI coding agents remember what they learned — across projects, across time.**

One persistent memory for Claude Code, Cursor, Gemini CLI, Windsurf, Cline, Codex, and OpenCode. Install once, every agent stays in context.

```bash
npm install -g hermit-graph && cd your-project && hermit setup
```

> *The Hermit carries a lantern to illuminate hidden truths — this graph carries your codebase wisdom.*

---

## The Problem

AI coding agents forget everything between sessions. You re-explain the same architecture. They make the same mistakes. Business rules get violated because the agent didn't know they existed.

**Hermit Graph fixes this.** It gives your agents a shared brain that persists across projects, sessions, and teams — automatically.

## Before & After

```
WITHOUT hermit-graph:
  Session 1: "We use Service Layer pattern, JWT auth with 7-day expiry..."
  Session 2: "As I explained before, we use Service Layer pattern..."
  Session 3: Agent violates a business rule it was never told about.
  Session 4: You mass-rename a function. 3 files break silently.
  You catch it in code review. It happens again next week.

WITH hermit-graph:
  Day 0:    hermit setup → brain seeded with your stack + rules
  Session 1: /deep-scan → business rules, API surface, models captured
  Session 2: Auto-recall fires → agent knows everything from line 1
  Session 3: /impact validateUser → shows 12 callers before you touch it
  Every session after: zero re-explaining. Zero forgotten rules.
```

## Who This Is For

- **Solo dev juggling 3+ projects** — tired of re-explaining architecture decisions to every AI session
- **Small team** where agents repeat mistakes because there's no institutional memory
- **Tech lead** who needs AI to respect business rules, not just generate code fast
- **Multi-agent user** (Claude + Cursor + Gemini) who wants one shared brain, not three separate contexts

## How It Works

```
You -> AI Agent -> Hermit Brain (brain.jsonl)
                      |
               Search . Recall . Learn
                      |
          All your other projects & agents
```

Your agents save decisions, patterns, rules, and bugs into a structured knowledge graph. Next time — in any project, with any agent — they find it instantly.

---

## Quick Start

**1. Install**
```bash
npm install -g hermit-graph
```

**2. Setup in your project**
```bash
cd /path/to/your-project
hermit setup                    # Configures ALL agents + auto-learns project identity
```

Setup auto-detects your tech stack from `package.json`, `tsconfig.json`, `README.md`, etc. and seeds the brain with `BIZ:` and `TECH:` entities — so agents have context from session #1.

**3. Deep scan** (optional, first AI session) — for full project mastery:
> *Run `/deep-scan` to teach your agent: business rules, API surface, data models, architecture.*

**4. Verify** — ask your agent:
> *"Do you have memory tools? Try `search_nodes` with keyword test."*

That's it. Memory is live.

---

## Suggested Flow

### Day 0 — Setup (once per project)

```
hermit setup
  ├── Configures all detected agents (MCP, hooks, rules)
  ├── Auto-learns project identity (TECH: + BIZ: entities)
  ├── Generates BUSINESS.md (pre-filled Domain + Tech Stack)
  └── Prints: "Run /deep-scan for full project mastery"
```

### Session 1 — Deep Scan (first AI session)

```
You:   /deep-scan
Agent: Scans codebase → extracts business rules, API surface,
       data models, architecture → writes RULE:, FLOW:, PATTERN: entities
       → fills BUSINESS.md impact chains
       (covers ~80% of Hermit's full power)
```

### Daily Sessions — Normal Development

```
┌─ Session Start (AUTO) ───────────────────────────────────┐
│  Auto-recall hook fires → searches brain for context     │
│  Agent knows: your stack, rules, past decisions, gotchas │
└──────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Before Editing Code (AUTO + manual) ────────────────────┐
│  /impact <symbol or file>                                │
│  → Auto-triggers on business logic edits (biz-guard)     │
│  → Or call manually: /impact <symbol>                    │
│  → Layer 1: CodeGraph blast radius (d=1/2/3)             │
│  → Layer 2: KG business rules at risk (RULE:/FLOW:)      │
│  → Layer 3: BUSINESS.md impact chains                    │
└──────────────────────────────────────────────────────────┘
         │
         ▼
┌─ While Coding (manual, use as needed) ───────────────────┐
│  /biz-review  — validate code vs documented rules        │
│  /recall      — search what you learned before           │
│  /diagnose    — debug with root cause + save incident    │
└──────────────────────────────────────────────────────────┘
         │
         ▼
┌─ After Each Response (AUTO) ─────────────────────────────┐
│  Auto-update hook fires → extracts entities from convo   │
│  Contradiction detection + confidence-weighted decay     │
└──────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Session End (manual, recommended) ──────────────────────┐
│  /brain-dump  — save everything not yet captured         │
└──────────────────────────────────────────────────────────┘
```

> **What's automatic:** Session recall, entity extraction after each response, biz-guard on business logic edits. **What's manual:** `/biz-review`, `/recall`, `/diagnose`, `/brain-dump` — use as needed.

### Periodic Maintenance

| When | Command | What it does |
|------|---------|-------------|
| Weekly | `/brain-health` | Score 0-100, flags stale/orphan/low-confidence |
| New project | `/suggest-reuse` | Find patterns from other projects |
| Tech decision | `/tech-decision` | Record decision with context + trade-offs |
| Business rule change | `/remember` or `/ingest` | Save rule to KG immediately |

### What Builds Up Over Time

```
Session 1:   TECH: + BIZ: (auto-learn)
Session 2:   + RULE: + FLOW: (deep-scan)
Session 3+:  + PATTERN: + INCIDENT: + DECISION: (auto-capture)
             + Cross-project recall
             + Contradiction detection
             + Confidence decay (stale knowledge auto-flagged)
```

> **Auto-learn = 20% seed. `/deep-scan` = 80%. Ongoing sessions = remaining 20%.**

---

## What You Get

### Keep Agents in Context
- **Cross-project memory** — Learn a pattern in Project A, recall it in Project B
- **Semantic + keyword search** — Find knowledge by concept or exact phrase
- **Automatic staleness detection** — Flags old knowledge (180+ days) for review
- **Confidence scoring** — Distinguish verified facts `[0.95]` from experiments `[0.5]`

### Code Intelligence (v6)
- **Symbol search** — Find functions, classes, methods by concept
- **Impact analysis** — Know what breaks before you change it (d=1 WILL_BREAK, d=2 LIKELY_AFFECTED, d=3 MAY_NEED_TESTING)
- **Context view** — See all callers and callees of any symbol
- **Process detection** — Discover execution flows automatically
- **Unified search** — Search knowledge graph AND code symbols together in one query

### Enforce Business Rules
- **Business rule guard** — `/biz-review` validates code against documented rules before merge
- **Impact analysis** — `/impact` shows blast radius before you change anything
- **Cross-project reuse** — `/suggest-reuse` finds reusable patterns from your other projects

### Automate Knowledge Capture
- **Auto-learn on setup** — `hermit setup` scans project files and seeds the brain with tech stack + project identity
- **Deep scan** — `/deep-scan` teaches your agent business rules, API surface, data models, architecture (80% of full power)
- **Auto-recall hooks** — Before each response, agents search the brain for relevant context
- **Auto-update hooks** — After each response, entities are extracted from conversation automatically
- **Entity extraction** — 6 regex extractors catch tech decisions, error patterns, explicit refs, and more
- **Contradiction detection** — Same-category observations are auto-superseded with audit trail
- **Confidence-weighted decay** — Auto-extracted knowledge (0.5) decays in 30 days; explicit knowledge (0.9+) lasts 180 days
- **14 slash commands** — `/remember`, `/recall`, `/brain-dump`, `/diagnose`, `/ingest`, etc.

### Work Across 7 Agents
- **One memory, seven agents, zero conflicts** — File-lock safe concurrent access
- **MCP protocol** — Standard integration via 30 tools + 1 resource (all annotated with readOnlyHint/idempotentHint)
- **Native hooks for 5 agents** — Auto-recall and auto-update hooks for Claude, Cursor, Gemini, Cline, Codex
- **Skill distribution** — Export skills, commands, and hooks to any agent in their native format
- **Zero-config setup** — `hermit setup` configures all detected agents in one command

### Visualize & Audit
- **Knowledge Graph viewer** — WebGL graph viewer with search, filter, type clustering, minimap, dark theme
- **CodeGraph viewer** — Code symbol visualization with file tree, color-by modes, blast radius analysis, business rule overlay
- **Brain health check** — 5-check scoring (stale, dupes, orphans, low-confidence, missing relations). Score 0-100
- **Neo4j (optional)** — Full graph database with Cypher queries via Docker

<p align="center">
  <img src="https://raw.githubusercontent.com/kimbapquyenduy/hermit-graph/main/assets/kg-viewer-entity-details.png" alt="Knowledge Graph Viewer — entity details" width="800" />
  <br><em>Knowledge Graph Viewer — browse entities, view observations, search across your brain</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/kimbapquyenduy/hermit-graph/main/assets/kg-viewer-related-traversal.png" alt="Knowledge Graph Viewer — related traversal" width="800" />
  <br><em>Related Traversal — 2-hop BFS from any node, depth-colored blast radius</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/kimbapquyenduy/hermit-graph/main/assets/codegraph-viewer-impact-analysis.png" alt="CodeGraph Viewer — impact analysis" width="800" />
  <br><em>CodeGraph Viewer — code symbols with impact analysis, severity badges, business rule overlay</em>
</p>

---

## Why Hermit Graph?

| | Hermit Graph | CLAUDE.md (manual) | Git Notes | Linear / Notion |
|---|:---:|:---:|:---:|:---:|
| **Searchable** | Semantic + keyword | Manual search | Limited | External |
| **Multi-agent** | 7 agents, file-lock safe | Per-project | Per-branch | Per-workspace |
| **Structured** | 4-tier taxonomy, 13 types | Unstructured | Unstructured | Manual structure |
| **Auto-capture** | Hooks extract entities | Manual save | Manual | Manual |
| **Code intelligence** | Built-in ast-grep | None | None | None |
| **Works offline** | Local JSONL | Local | Local | Needs internet |
| **Cost** | Free (MIT) | Free | Free | $10-20/mo |

---

## Agent Support

| Feature | Claude Code | Cursor | Gemini CLI | Windsurf | Cline | Codex | OpenCode |
|---------|:-----------:|:------:|:----------:|:--------:|:-----:|:-----:|:--------:|
| MCP memory server | auto | auto | auto | auto | auto | auto | auto |
| brain.jsonl | auto | auto | auto | auto | auto | auto | auto |
| Auto-learn on setup | auto | auto | auto | auto | auto | auto | auto |
| Code intelligence | auto | auto | auto | auto | auto | auto | auto |
| Skills (6) | auto | export | export | -- | export | export | export |
| Slash commands (14) | auto | export | export | -- | -- | export | export |
| Auto-recall hook | auto | export | export | -- | export | export | export |
| Auto-update hook | auto | export | export | -- | export | export | export |
| Rules file | auto | auto | auto | auto | -- | -- | auto |
| BUSINESS.md template | auto | auto | auto | auto | auto | auto | auto |

```bash
hermit setup                    # Configures ALL agents + auto-learns project
hermit setup --agent cursor     # Cursor only
hermit setup --agent gemini     # Gemini CLI only
hermit setup --agent windsurf   # Windsurf only
hermit setup --agent cline      # Cline (VS Code extension) only
hermit setup --agent codex      # OpenAI Codex CLI only
hermit setup --agent opencode   # OpenCode only
hermit setup --mcp-only         # Any agent — just prints MCP config
hermit setup --skip-learn       # Skip auto-learning project identity
```

> By default, `hermit setup` configures all agents at once — Claude Code gets native `.claude/` integration, other agents get MCP config + hooks + rules in their native formats.

<details>
<summary><strong>Manual MCP setup (any agent)</strong></summary>

```json
{
  "mcpServers": {
    "hermit": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH>/hermit-graph/scripts/hermit-mcp-server.mjs"],
      "env": {
        "MEMORY_FILE_PATH": "<ABSOLUTE_PATH>/hermit-graph/data/brain.jsonl"
      }
    }
  }
}
```

Replace `<ABSOLUTE_PATH>` with your clone path. Use forward slashes on all platforms.

| Agent | Config path |
|-------|------------|
| Claude Code | `~/.claude/settings.json` |
| Cursor | `~/.cursor/mcp.json` or `.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline | VS Code `settings.json` -> `cline.mcpServers` |
| Codex | `~/.codex/config.toml` |
| OpenCode | `.opencode/config.json` |

</details>

---

## Code Intelligence

Hermit v6 includes built-in code analysis powered by [ast-grep](https://ast-grep.github.io/) + `all-MiniLM-L6-v2` embeddings. No external tools, no subprocesses — fast, in-process AST + vector search.

### How It Works

```
Your Project  -->  ast-grep parser  -->  CodeGraph (symbols + relations)
                         |                       |
                         v                       v
               code-symbols.jsonl       code-embeddings.json (384-dim)
                         |                       |
                         v                       v
       query (semantic) / context / impact / detect_changes / index
```

### What It's Good At (And What It Isn't) — Honest Benchmark

Hermit is a **targeted enhancement, not a Grep replacement.** Real benchmark on WebCash (420 files, 3909 symbols), same refactor-planning task:

| Task shape | Winner | Why |
|------------|--------|-----|
| "Rename `ssoLogin` → `singleSignOnLogin`" (literal name known) | **Grep** (89s, 5 calls, 61k tokens) | Grep matches the literal string directly. Adding hermit = +69% time, +140% tool calls, +16% tokens for the same correct answer. |
| "Find the authentication/payment/billing layer" (concept) | **Hermit** (`hermit_query`) | Semantic vector match surfaces `User.handle`, `verifyOTPToken`, `getSSOToken` ranked by relevance. Grep flounders in 1000+ noise matches. |
| "What breaks if I change `verifyOTPToken`?" (transitive callers) | **Hermit** (`hermit_impact`) | AST call graph returns d=1/d=2/d=3 with decay-weighted risk. Grep can only find direct string matches, not transitive chains. |
| "Which of the 5 `handle()` methods is the auth middleware?" (name collision) | **Hermit** (`hermit_context`) | Disambiguation returns `ClassName.methodName` candidates. Grep returns 100s of hits mixed with noise. |

**Rule of thumb:** reach for hermit when you **don't know the name** or when **transitive breakage matters.** Grep when the name is literal.

### MCP Tools

| Tool | Best for | Not great for |
|------|----------|---------------|
| `hermit_query({query, cwd})` | Concept-level discovery when name is unknown ("auth layer", "payment retry"). Hybrid vector + keyword, ~300ms after first-call index build. | Literal-name lookup — Grep is faster. |
| `hermit_context({name, cwd})` | 360° view of ONE symbol: callers + callees in one shot. Auto-disambiguates common names (`handle`, `run`) with `ClassName.methodName` support. | Exploring many symbols at once. |
| `hermit_impact({target, direction, cwd})` | **Before editing any exported function.** Returns d=1 WILL_BREAK, d=2 LIKELY_AFFECTED, d=3 MAY_NEED_TESTING with confidence decay + risk level. Hints when symbol is framework-bound (middleware, job, handler). | Quick "is this used?" checks — hermit_context is cheaper. |
| `hermit_unified_search({query, cwd})` | One-shot search across saved knowledge (past decisions) AND code symbols. Useful at the start of an unfamiliar task. | Tight-loop queries — use hermit_query directly. |
| `hermit_detect_changes({cwd})` | Pre-commit scope verification ("does my change match the planned scope?"). Queries auto-reindex on stale — this is rarely needed directly. | Routine checks. |
| `hermit_index({cwd})` | Force fresh rebuild after drastic structure change (branch switch, large rebase). | Rarely needed — auto-index runs on first query. |

### Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | **WILL BREAK** — direct callers/importers | MUST update these |
| d=2 | **LIKELY AFFECTED** — indirect deps | Should test |
| d=3 | **MAY NEED TESTING** — transitive | Test if critical path |

**Framework-binding hint:** when a symbol looks framework-dispatched (file in `/middleware`, `/commands`, `/jobs` + conventional name like `handle`, `run`, `execute`) and has 0 AST callers, hermit_impact adds a hint directing you to grep routes/config for string-based references. AST can't see `Route::post("url", "Controller.method")` string dispatch.

### Languages Supported

- **JavaScript** (.js, .mjs, .cjs, .jsx)
- **TypeScript** (.ts, .tsx)
- **Python** (.py) — via optional `@ast-grep/lang-python`
- **Java** (.java) — via optional `@ast-grep/lang-java`, captures annotations (`@Service`, `@Controller`, `@Transactional`, etc.)
- **MyBatis XML mappers** (.xml with `<mapper namespace=...>` schema) — `<select|insert|update|delete>` statements cross-linked to Java interface methods via `fast-xml-parser`. Editing a Java interface method surfaces its XML mapper as d=1 caller

### Performance (real numbers)

| Operation | Time | Note |
|-----------|------|------|
| Full index (85 files) | ~2s | Small repo |
| Full index (3909 symbols, WebCash) | ~44s | Medium repo, one-time |
| Semantic embedding build (3909 symbols) | ~17s | One-time, cached to `data/code-embeddings.json` |
| `hermit_query` (cached) | ~300ms | Vector + keyword hybrid |
| `hermit_context` | <20ms | AST lookup |
| `hermit_impact` | <30ms | BFS on pre-built graph |
| Auto-reindex on stale | <100ms | Incremental, no-op when clean |

---

## CLI Reference

```bash
# Knowledge graph
hermit search <query>     # Hybrid semantic + keyword search
hermit health             # Brain health check (score 0-100)
hermit index [--force]    # Build/rebuild embedding index
hermit export             # Export MCP DB to brain.jsonl
hermit stale              # Report stale observations (>180 days)
hermit serve              # Start MCP memory server
hermit view               # Open Knowledge Graph viewer
hermit view --code        # Open CodeGraph viewer (code symbols + brain rules)

# Skills management
hermit skills                          # List all 6 skills + 14 commands
hermit skills add --all                # Install all skills + commands + hooks
hermit skills info <name>              # Show skill details
hermit skills installed                # Show what's installed

# Multi-agent distribution
hermit skills export --all --agent cursor --project /path   # Skills to Cursor
hermit skills export --all --agent gemini --global          # Skills to Gemini
hermit skills export --all --hooks --agent all --project /path  # Hooks to all agents
```

<details>
<summary><strong>NPM Scripts</strong></summary>

```bash
npm test                  # Run test suite (103 tests + 16 e2e)
npm run health            # Brain health check
npm run sync              # Sync graph to Neo4j
npm run view              # Open Knowledge Graph viewer
npm run view:code         # Open CodeGraph viewer
npm run build:index       # Build semantic embedding index
npm run export            # Export MCP DB to brain.jsonl
npm run stale             # Stale observation report
npm run migrate           # Migrate v3 to v4 format
npm run setup             # Setup Hermit Graph for a new project
npm run setup:semantic    # Setup semantic search (JS-native)
npm run setup:all         # Setup everything (project + semantic)
npm run test:e2e          # Run e2e code intelligence tests (16 tests)
npm run test:all          # Run unit + e2e tests together
npm run publish:dry       # Preview what npm will package
```

> `npm publish` auto-runs preflight checks (git clean, version/changelog sync, tests, secrets scan, node version). See `scripts/publish-preflight.mjs`.

</details>

<details>
<summary><strong>Slash Commands (14)</strong></summary>

| Command | What it does |
|---------|-------------|
| `/remember` | Save info to memory |
| `/recall` | Search saved info |
| `/brain-dump` | End-of-session save-all |
| `/brain-health` | Graph health check (score 0-100) |
| `/impact` | Analyze blast radius before code changes |
| `/biz-review` | Review code against business rules |
| `/biz-init` | Create BUSINESS.md for new project |
| `/diagnose` | Debug with root cause analysis |
| `/ingest` | Ingest docs (BRD/PRD/README) into knowledge graph |
| `/tech-decision` | Record technical decisions |
| `/learn-project` | Auto-detect project conventions |
| `/suggest-reuse` | Find reusable patterns from other projects |
| `/deep-scan` | Full project mastery scan (business rules, API, models) |
| `/ask` | Ask technical/architectural questions with expert consultation |

</details>

---

## How Knowledge Is Organized

Hermit uses a **4-tier taxonomy** to categorize everything your agents learn:

| Tier | What it captures | Example |
|------|-----------------|---------|
| **BIZ** | Business rules, flows, domain entities | `RULE:ShopX:DiscountMax50` |
| **PATTERN** | Code patterns, architecture, integrations | `PATTERN:INT:VNPay` |
| **TECH** | Stack decisions, config, people | `TECH:EduMVP` |
| **INCIDENT** | Bugs, gotchas, lessons learned | `INCIDENT:ShopX:PaymentTimeout` |

Every observation is tagged with confidence `[0.0-1.0]` and date. Stale entries (180+ days) are auto-flagged for review.

---

## Bridging External MCP Servers

> **SECURITY WARNING:** The bridge config file (`~/.hermit/mcp-bridges.json`) **executes arbitrary commands** when a bridge is enabled. Treat it exactly like your shell rc file — **only enable bridges from sources you fully trust.** A malicious bridge config can run any command as your user. All bridges ship disabled by default.

Brain can act as a transparent proxy to other MCP servers, surfacing their tools to agents under a namespaced prefix (`mcp_<bridge>_<tool>`). Agents see foreign tools as if they were native Brain tools.

### Quick Start

1. Edit `~/.hermit/mcp-bridges.json` (created by `hermit setup`):
   ```json
   [
     {
       "name": "time",
       "transport": "stdio",
       "command": "npx",
       "args": ["-y", "mcp-server-time"],
       "enabled": true
     }
   ]
   ```
2. Restart Brain (restart your IDE/agent MCP server).
3. Agents now see `mcp_time_get_current_time` (and any other tools the server exposes).

### Transport Types

| Transport | Config fields required | Use case |
|-----------|----------------------|----------|
| `stdio`   | `command`, `args`    | Local servers (99% of cases) |
| `http`    | `url`                | Remote/hosted MCP servers |

### Bridge Name Rules

- Lowercase alphanumeric + underscore only: `^[a-z][a-z0-9_]*$`
- Max 32 characters
- Tool names with special characters are sanitized (`-` → `_`, etc.)

### Bridge Management Tools

| Tool | Description |
|------|-------------|
| `hermit_list_bridges` | List all bridges: status, tool count, circuit breaker state |
| `hermit_reload_bridges` | Re-read config and apply diff — no Brain restart needed |
| `hermit_enable_bridge` | Reset circuit breaker for a bridge (also restarts dead bridges) |

### Circuit Breaker

Each bridge has an automatic circuit breaker. After **3 consecutive call failures**, the bridge is marked "circuit open" and all calls return a clear error. The breaker auto-recovers after **5 minutes**, or immediately via `hermit_enable_bridge({ name: "..." })`.

### Resilience

- Subprocess crash → automatic restart with exponential backoff (1s, 2s, 4s)
- After 3 restarts → bridge marked `dead`; use `hermit_enable_bridge` to revive
- One bridge crashing never affects other bridges
- `shutdownAll()` on SIGINT/SIGTERM — all subprocesses exit within 2s

---

## Optional Features

<details>
<summary><strong>Semantic Search</strong></summary>

Enables vector-based similarity search on top of keyword matching.

```bash
npm run setup:semantic    # Downloads model (~23MB, offline, no Python)
npm run build:index       # Builds embedding index from brain.jsonl
```

Uses transformers.js + all-MiniLM-L6-v2 ONNX. Fully offline, JS-native.

</details>

<details>
<summary><strong>Auto-Learn on Setup</strong></summary>

`hermit setup` automatically scans your project and seeds the brain with basic context — no AI session needed.

**What it detects:**
- `package.json` — name, description, frameworks, build tools, test framework, module system
- `tsconfig.json` — TypeScript usage
- `README.md` — project description (first H1)
- `pyproject.toml` / `go.mod` / `Cargo.toml` — Python, Go, Rust projects
- `Dockerfile` / `docker-compose.*` — containerization
- `.github/workflows/` — CI/CD

**What it creates:**
- `TECH:ProjectName` (tech-stack) — STACK, FRONTEND, BACKEND, BUILD, TEST, INFRA observations
- `BIZ:ProjectName` (biz-domain) — WHAT, PROJECT observations
- Relation: `BIZ:ProjectName` → `uses_tech` → `TECH:ProjectName`

All auto-learned observations use `[0.6|date]` confidence (auto-detected, unverified). Skip with `--skip-learn`.

**For full project mastery**, run `/deep-scan` in your first AI session — this teaches your agent business rules, API surface, data models, and architecture (covers ~80% of Hermit's full power).

</details>

<details>
<summary><strong>Auto-Update Hook (v5+)</strong></summary>

Scans assistant messages after each response and extracts entities via regex — no LLM re-parse needed. Entities written with `[0.5|date]` confidence (auto-extracted, unverified).

**Features:**
- 6 regex extractors (tech decisions, error patterns, explicit refs, and more)
- Contradiction detection — same-category observations auto-superseded with audit trail
- Confidence-weighted decay — auto-extracted (30d half-life), default (70d), explicit (180d)
- 5-second timeout guard — never blocks session close

**Claude Code** — auto-configured by `hermit setup`. Or add manually:

```json
"hooks": {
  "Stop": [{
    "matcher": "*",
    "hooks": [{
      "type": "command",
      "command": "node <HERMIT_PATH>/catalog/hooks/kg-auto-update.cjs"
    }]
  }]
}
```

**Other agents** — `hermit hooks export --all --agent <agent> --project /path`

Set `HERMIT_AUTO_UPDATE=false` to disable.

</details>

<details>
<summary><strong>Graph Viewers</strong></summary>

Hermit includes two interactive WebGL graph viewers powered by Sigma.js + Graphology.

**Knowledge Graph Viewer** — visualize your brain entities and relations:

```bash
hermit view               # or: npm run view
```

**CodeGraph Viewer** — visualize code symbols with business rule overlay:

```bash
hermit view --code        # or: npm run view:code
```

Both viewers open in your default browser as self-contained HTML files (no server needed).

#### Shared Controls

| Action | How |
|--------|-----|
| **Pan** | Click and drag background |
| **Zoom** | Scroll wheel or `+`/`-` keys |
| **Select node** | Click on a node |
| **Deselect** | Press `Esc` or click background |
| **Search** | `Ctrl+F` or click search box |
| **Toggle sidebar** | Press `S` or click sidebar toggle arrow |
| **Toggle layout** | Press `L` or click Layout button |
| **Spread nodes** | Click Spread button (pushes overlapping nodes apart) |
| **Cluster by type** | Click Cluster button |
| **Drag node** | Click and drag a node to reposition |
| **Pin node** | Right-click → Pin (prevents layout from moving it) |
| **Export PNG** | Press `E` or right-click → Export PNG |

#### Knowledge Graph Viewer

- **Filter chips** — click entity type badges to show/hide types
- **Related button** — select a node, click "Related" to highlight 2-hop neighborhood with edge dimming
- **Confidence colors** — node size reflects connection degree, stale observations show red border
- **Right-click menu** — Focus neighborhood, pin/unpin, copy name, export

#### CodeGraph Viewer

- **File tree sidebar** — browse symbols by file, click to navigate
- **Color By modes** — switch between Kind (function/class/method), Folder, or Language coloring
- **Stats grid** — Files, Symbols, Links, Languages at a glance
- **Impact mode** — select a symbol, click "Impact" to see blast radius (d1=red, d2=yellow, d3=blue) with severity badge and percentage bar
- **Business rules** — auto-loads `brain.jsonl`, matches RULE:/FLOW: entities to code symbols by file path, shows in detail panel and impact panel
- **Selection ring** — blue ring highlights the currently selected node
- **Collapsible sections** — detail panel sections expand/collapse with chevron toggle

</details>

<details>
<summary><strong>Neo4j Viewer</strong></summary>

```bash
cd docker && docker compose up -d
cp .env.example .env    # set password
npm run sync
# Open http://localhost:7474
```

</details>

---

## Trace Bus (opt-in skill-evolution wiring)

> **PRIVACY NOTICE:** Trace events may contain query text, tool arguments, and file paths from your working directory. This feature is **opt-in only** and disabled by default. Do not enable in shared or CI environments without reviewing what is captured.

Hermit v7 includes a frozen v1 event bus that records execution traces for future auto-tuning pipelines (DSPy/GEPA). The bus is **wiring only** — no mutation, training, or scoring logic is included.

### How to enable

```bash
# In-memory ring buffer only (no disk write)
HERMIT_TRACE_BUS=1 <your agent MCP config>

# With file sink (append-only JSONL)
HERMIT_TRACE_BUS=1 HERMIT_TRACE_SINK=/tmp/hermit-traces.jsonl <your agent MCP config>
```

### Inspect recent events

```json
{ "name": "hermit_tap_traces", "arguments": { "n": 50 } }
```

Returns the last N events from the in-memory ring buffer. Returns `[]` when trace bus is disabled.

### Trace event types (frozen v1 schema)

| Event | Emitted by | When |
|-------|-----------|------|
| `tool:call` | memory + codegraph modules | Before each tool handler runs |
| `tool:result` | memory + codegraph modules | After each tool handler completes |
| `search:query` | `hermit_unified_search` | After search results are merged |
| `search:fusion` | hybrid retrieval | After RRF fuses BM25 + vector rankings |
| `bridge:forward` | MCP bridge proxy | After each forwarded bridge call |

Full schema: [`docs/skill-evolution-trace-schema.md`](docs/skill-evolution-trace-schema.md)

### What is NOT included

- No DSPy/GEPA integration
- No prompt mutation or rewriting
- No training loops or scoring
- No redaction filters (future work)

### File sink notes

- Append-only JSONL; one event per line
- `HERMIT_TRACE_SINK` must point to a writable path — never writes to a default location
- No rotation policy — monitor disk usage manually

---

## Project Structure

<details>
<summary><strong>View full tree</strong></summary>

```
hermit-graph/
├── catalog/
│   ├── skills/                  # 6 hermit-graph skills
│   ├── commands/                # 14 slash commands
│   └── hooks/                   # Auto-recall + auto-update hooks (7 agents)
│       ├── kg-auto-recall*.cjs  # Pre-response context recall
│       ├── kg-auto-update*.cjs  # Post-response entity extraction
│       ├── session-hook-*.cjs   # Session start hooks
│       └── lib/                 # Shared hook logic
├── data/
│   ├── brain.jsonl              # Knowledge graph data
│   ├── code-symbols.jsonl       # Code intelligence index (auto-generated)
│   ├── brain-embeddings.json    # Semantic search index
│   └── conventions/             # Auto-learned conventions
├── scripts/
│   ├── brain-cli.mjs            # CLI entry point
│   ├── skills-manager.mjs       # Skill install/remove/list/export
│   ├── hermit-mcp-server.mjs    # MCP server (30 tools + 1 resource)
│   └── lib/
│       ├── code-intel/          # Built-in code intelligence (v6)
│       │   ├── parser.mjs       # ast-grep wrapper (JS/TS/Python)
│       │   ├── extractor.mjs    # Symbol & relation extraction
│       │   ├── graph.mjs        # In-memory CodeGraph data structure
│       │   ├── code-io.mjs      # JSONL persistence (mtime-cached)
│       │   ├── impact.mjs       # Blast radius analysis (3-hop BFS)
│       │   ├── indexer.mjs      # Full + incremental indexing
│       │   ├── process-detector.mjs  # Execution flow detection
│       │   └── index.mjs        # Public API facade
│       ├── codegraph-module.mjs # 5 MCP code intelligence tools
│       ├── unified-search.mjs   # KG + code unified search
│       └── ...                  # 10+ other modules
├── viewer/
│   ├── index.html               # Knowledge Graph viewer (Sigma.js WebGL)
│   └── code-viewer.html         # CodeGraph viewer (code symbols + brain rules)
├── docker/docker-compose.yml    # Neo4j (optional)
├── templates/                   # CLAUDE.md, BUSINESS.md templates
└── package.json                 # v6.3.0
```

</details>

## FAQ

<details>
<summary><strong>Agent doesn't remember anything?</strong></summary>

Check your agent's MCP config — JSON must be valid, `MEMORY_FILE_PATH` must be an absolute path to `data/brain.jsonl`. Restart your AI agent after changes.

</details>

<details>
<summary><strong>Want to reset memory?</strong></summary>

Clear contents of `data/brain.jsonl` (keep the file, delete all lines).

</details>

<details>
<summary><strong>Data file too large?</strong></summary>

Works fine up to several MB. Over 10MB, run `hermit stale` and archive old entries.

</details>

<details>
<summary><strong>Semantic search not working?</strong></summary>

Run `npm run setup:semantic` then `npm run build:index`. Requires Node.js 18+.

</details>

<details>
<summary><strong>Code intelligence not finding symbols?</strong></summary>

Run `hermit_index({cwd: "/path/to/project"})` to force a full reindex. The index auto-creates on first query but may need a refresh after large changes.

</details>

---

## What's New in v7.1.0 — Token Diet + Framework Resolvers + Multi-Worker Indexer

A capability + efficiency release on top of v7.0's SQLite foundation. **No breaking changes** — `HERMIT_TOOL_PROFILE=full` restores the original 34-tool surface.

**Measured on real projects:**
- Indexing **-84%** wall time (EduMVP 27.5s → 4.5s; Vue 2.6 enterprise app 167s → 30s)
- Session tokens **-58.6%** via tool-surface diet (catalog 4,775 → 1,635 tokens)
- `hermit_impact` payload **-92%** via counts-first default

**Headline features:**
- **9 framework resolvers** — Express, Laravel, NestJS, React, Vue, Django, Rails, Svelte, Shopify Liquid. Each auto-detects from project config, emits framework-resolved edges (JSX renders, route handlers, controller dispatches, etc.) that the AST extractor misses.
- **Vue + Svelte + Liquid SFC extractors** — parse `<script>` blocks, extract component members, line-offset-preserving.
- **Multi-strategy resolution cascade** — framework → import → name, with confidence scoring + provenance on every edge.
- **Multi-worker parallel indexer** — auto-enables at ≥ 50 files. `Promise.all` fan-out across CPU cores with stable-hash routing so pass-2 hits cached AST. Name-indexed O(1) symbol lookup.
- **Token-conscious defaults** — `HERMIT_TOOL_PROFILE=core` (10 tools), `HERMIT_AUTORECALL=smart` (skip on trivial prompts), 15K-char output cap, compact response format, container outline for class context, anti-pattern coaching in tool descriptions.
- **`~/.hermit/frameworks.json`** override config (`disable: [...]` / `override: [...]`).
- **4 reproducible bench harnesses** under `scripts/bench/` + `npm run bench:tokens|hard|functional|framework-e2e`.

See `docs/project-changelog.md` for the full feature list and `docs/benchmarks/2026-Q2.md` for the measurement report.

---

## What's New in v7.0 — SQLite Single Source of Truth

**v7.0 is a breaking change in storage behavior**: `brain.jsonl` is no longer auto-written. SQLite (`brain.db`) + `sqlite-vec` are now the single source of truth for all reads and writes.

### Auto-migration on first boot

If you have a v6 `brain.jsonl` vault and no `brain.db`, the MCP server auto-migrates on first boot:

```
[hermit] Boot: v6 vault detected — starting auto-migration...
[hermit] Boot: v6 → v7 migration complete (620 entities). Backup: brain.jsonl.v6-backup-20260505
```

- Original `brain.jsonl` is **backed up** (renamed to `brain.jsonl.v6-backup-{date}`), never deleted.
- Set `HERMIT_AUTO_MIGRATE=1` to skip the interactive prompt.

### Manual migration

```bash
# JSONL → SQLite
hermit-migrate

# Backfill vector embeddings (for hybrid search)
hermit-migrate-vec --from-jsonl data/brain.jsonl
```

### Export SQLite back to JSONL (disaster recovery)

```bash
hermit-export-jsonl --db data/brain.db --to data/brain.jsonl.recovered
# or via CLI:
hermit export
```

### Escape hatch — restore dual-write temporarily

```bash
# Also write JSONL on every write (marked for removal in v8.0)
HERMIT_LEGACY_DUAL_WRITE=1 hermit serve
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HERMIT_PRIMARY_READ` | `sqlite` | Read source: `sqlite` (default) or `jsonl` |
| `HERMIT_RETRIEVAL` | `bm25` | Search mode: `bm25`, `hybrid`, or `vector` |
| `HERMIT_LEGACY_DUAL_WRITE` | unset | Set to `1` to re-enable JSONL fan-out (v8.0 removal target) |
| `HERMIT_AUTO_MIGRATE` | unset | Set to `1` to skip v6 migration confirmation prompt |
| `HERMIT_EMBED_MODE` | `eager` | Vector embed on write: `eager` or `lazy` |
| `HERMIT_TOOL_PROFILE` | `core` | Tool surface: `core` (10 tools, ~1500 catalog tokens) or `full` (34 tools). Token-diet default. |
| `HERMIT_AUTORECALL` | `smart` | Auto-recall gating: `smart` (gate on prompt content), `always` (fire every session), `off` (disable). Saves ~1500 tokens × ~50% of sessions when `smart`. |
| `HERMIT_AUTORECALL_LOG` | unset | Set to `1` to log auto-recall skip decisions to stderr. Debug aid. |
| `HERMIT_ID_MODE` | `legacy` | Symbol ID format: `legacy` (`file::name`) or `sha256` (collision-safe `kind:hash32`). v7 back-compat keeps legacy default. |
| `HERMIT_PARSE_WORKER` | auto | Multi-worker parser: `1` forces on, `0` forces off, otherwise auto-enables when project has ≥ 200 files. Measured -42% indexing time on 547-file repos. |
| `HERMIT_PARSE_RECYCLE` | `500` | Per-worker parse count before terminate+respawn to bound native heap. |

### Token-conscious defaults

Hermit ships with token-diet defaults that reduce session cost by ~58.6% vs the pre-diet baseline:

- **Tool surface diet** (`HERMIT_TOOL_PROFILE=core`) — 10 core tools cover ~95% of agent flows. Advanced 24 tools require `HERMIT_TOOL_PROFILE=full`.
- **Conditional auto-recall** (`HERMIT_AUTORECALL=smart`) — recall hook fires only when prompt has code/biz signal; trivial prompts skip the ~1500-token recall injection.
- **Compact response format** — symbol rows use `- name (kind) file:line [tags]`; impact returns counts + d=1 names only by default (pass `verbose: true` for full d=2/d=3 lists).
- **Container outline** — `hermit_context` on classes returns member outline (signatures + line numbers) instead of full body dumps.
- **Universal output cap** — all tool responses capped at 15,000 chars with clean-newline truncation.
- **Server instructions** — 60-line MCP playbook injected at init steers agents to the right tool by intent + avoids common anti-patterns ("don't grep first when looking up a symbol").
- **Min-score query filter** — concept queries with no high-confidence matches return an honest "no matches" instead of misleading low-score dross.

Set `HERMIT_TOOL_PROFILE=full` if you need any of the advanced tools (memory CRUD, skills export, MCP bridges, audit trail, …) and don't want to opt back in per-session.

## Migrating from v6 (JSONL) to v7 (SQLite)

Hermit v7 introduced SQLite as the primary storage backend. Migration is automatic on first boot, or can be run manually.

### Manual migration steps

```bash
# Step 1: Migrate JSONL → SQLite
hermit-migrate

# Step 2: Backfill vector index
hermit-migrate-vec --from-jsonl data/brain.jsonl

# Step 3: Export back to JSONL if needed
hermit-export-jsonl
```

### Notes

- Migration is **idempotent** — safe to run multiple times. Existing data is UPSERTed, no duplicates.
- Source `brain.jsonl` is **backed up** before migration and never deleted automatically.
- v6 vault auto-detected at boot: `brain.jsonl` present + `brain.db` absent → auto-migration runs.

---

## Changelog

### v6.3.2 — Public Release Readiness

- Add community files: SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md
- Add GitHub issue/PR templates and Dependabot config
- Include LICENSE in npm package
- Fix README image rendering on npmjs.com (use absolute URLs)
- Add license attribution to viewer CDN imports

### v6.3.0 — Dual Graph Viewers + Brain-Code Bridge

#### New
- **CodeGraph Viewer** (`viewer/code-viewer.html`) — WebGL viewer for code symbols with file tree sidebar, color-by-kind/folder/language, impact blast radius with severity badges, collapsible detail panels, and selection ring
- **Brain-Code bridge** — CodeGraph viewer auto-loads `brain.jsonl`, matches RULE:/FLOW: entities to code symbols by file path (3-strategy: exact, basename, partial), shows affected rules in detail + impact panels
- **Related entities** (KG viewer) — "Related" button on selected nodes performs BFS 2-hop traversal with edge dimming, depth-colored nodes (d1=red, d2=yellow), and impact panel
- **Deep Scan Collector** — `deep-scan-collector.mjs` for structured phase-based project scanning
- **`hermit view --code`** — CLI flag to open CodeGraph viewer instead of KG viewer
- **Sidebar reopen button** — Floating `▶` tab appears when sidebar is collapsed (CodeGraph viewer)
- **Node overlap resolution** — Post-layout collision detection pushes overlapping nodes apart every iteration

#### Improved
- Force layout tuning — weaker attraction (nodes spread more), overlap resolution per iteration, stronger Spread button (10x repulsion)
- Selection ring uses raw graph coordinates → `graphToViewport()` (correct Sigma.js v2 coordinate chain)
- Node size multipliers reduced to prevent compounding (selected 1.15x, impact target 1.2x, d1 1.15x, d2 1.05x)
- KG viewer: initial spread `±800` → `±2000`, area `n*8000` → `n*25000`, attraction scaled to 0.3x
- CodeGraph viewer: area multipliers `30k/50k/80k` → `80k/120k/200k`, attraction `0.08/0.15/0.3` → `0.008/0.02/0.05`

#### Fixed
- Related mode not exiting when clicking a different node — now auto-exits impact mode on node change
- Business rules not matching code symbols — file path matching was too strict (exact only), added basename + partial endsWith strategies
- Impact panel referenced undefined `bizRules` variable — fixed to collect from graph node attributes

### v6.2.0 — Hook Architecture Upgrade + MCP Annotations

#### New
- **Task-aware recall** — All recall hooks (7 agents, 10 files) switched from manual `extractKeywords → searchBrain → formatResults` chain to `core.recall()` with prompt-type detection, smart keyword extraction, relation expansion, and token budgeting (TASK_TOKEN_CAP=1500)
- **SubagentStart hook** — `kg-auto-recall.cjs` now fires on SubagentStart events, giving subagents KG context automatically
- **PreCompact hook** — `kg-pre-compact.cjs` reminds agents to save knowledge before context compaction
- **MCP tool annotations** — `readOnlyHint` and `idempotentHint` on all 30 tools across 9 modules for safe agent parallelism
- **YAML list frontmatter** — `parseFrontmatter()` supports `key:\n  - item` syntax; `parsePaths()` handles both string and array formats
- **Command context routing** — All 14 commands tagged with `context: fork` (8) or `context: inline` (6) for agent execution routing
- **Publish preflight** — `prepublishOnly` hook runs 8 automated checks before `npm publish` (git clean, version sync, tests, secrets scan)

#### Fixed
- Agent-specific recall hooks (cursor, cline, gemini, codex) were still using old manual chain — all 10 files updated
- `skill-index.mjs` `parsePaths()` crashed on array paths after frontmatter upgrade — added `Array.isArray()` guard
- MCP tool count test description mismatched assertion (28 vs 30)

### v6.1.0 — Unified Impact Bridge

#### New
- **Unified Impact Bridge** — `hermit_impact` now returns business rules at risk alongside code blast radius (3-layer: CodeGraph + KG rules + BUSINESS.md chains)
- **`biz-linker.mjs`** — Deterministic file-path join between blast radius and KG RULE/FLOW entities. No LLM needed
- **Auto-fill BUSINESS.md** — `hermit setup` generates BUSINESS.md pre-filled with auto-detected Domain + Tech Stack (not a blank template)
- **`project-learner.mjs`** — Deterministic project scanner: reads package.json, tsconfig, README, etc. Writes BIZ + TECH entities to brain on setup
- **Monorepo workspace scanning** — Auto-learn detects frameworks/tools in workspace packages (Yarn, npm, pnpm workspaces)
- **5-second timeout guard** on auto-update hook — never blocks session close

#### Fixed
- Hook `lib/` subdirectory now copies recursively during setup (hooks no longer break with MODULE_NOT_FOUND)
- Yarn Berry `workspaces` object format (`{packages: [...]}`) no longer crashes project scanner
- `ensureIndex` race condition — concurrent MCP calls now deduplicated via promise map
- Scoped npm package names (`@org/pkg`) no longer produce malformed entity names
- `resolveDataDir` now resolves relative `cwd` to absolute before path operations
- Dead `embeddings` param removed from `hermit_index` schema
- Removed `.claude-settings.json` from npm `files` array (privacy)
- Auto-update hook project name now uses PascalCase (consistent with KG naming)

### v6.0.1 — Security Fixes
- Purged stale GitNexus references
- Hardened edge cases across 5 core modules (6 security & stability fixes)

### v6.0.0 — Built-in Code Intelligence

#### Breaking Changes
- **Removed GitNexus dependency** — All code intelligence is now built-in via ast-grep
- **Deleted `gitnexus-runner.mjs`** — 296 LOC subprocess manager replaced by in-process analysis
- **`@ast-grep/napi`** added as bundled dependency (napi-rs prebuilt binaries, no node-gyp)

#### New
- **10 code-intel modules** in `scripts/lib/code-intel/` — parser, extractors (JS/TS + Python), graph, impact, indexer, process detector
- **Auto-indexing** — CodeGraph tools auto-index on first query if no index exists
- **Incremental indexing** — Only re-parses files changed since last git commit
- **Process detection** — Discovers execution flows via DFS call chain tracing
- **Unified search** — `hermit_unified_search` merges KG entities + code symbols in one query

#### Improved
- **103 tests + 16 e2e passing** (up from 100)
- **MCP server** boots with all 30 tools, zero external dependencies
- **Performance** — Full index ~2s, queries <10ms, impact <20ms

---

## License

**MIT License** — Hermit Graph is free and open source. All dependencies are permissively licensed (MIT, ISC, BSD, Apache-2.0).

---

## Get Started

```bash
npm install -g hermit-graph && cd your-project && hermit setup
```

Then run `/deep-scan` in your first AI session for full project mastery.

If Hermit Graph helps you, [star the repo](https://github.com/kimbapquyenduy/hermit-graph) — it helps others find it.

---

<p align="center">
  Built for developers who want their AI agents to actually learn.
</p>
