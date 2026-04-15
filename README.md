<p align="center">
  <img src="https://img.shields.io/npm/v/hermit-graph?style=flat-square&color=blue" alt="npm version" />
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

## What's New in v6.0.0

**Built-in Code Intelligence** — ast-grep powered code analysis replaces the external GitNexus dependency. Zero subprocesses, <100ms queries, fully MIT licensed.

- **`hermit_query`** — Find code by concept (symbols + execution flows)
- **`hermit_context`** — 360-degree view of any symbol (callers, callees)
- **`hermit_impact`** — Blast radius analysis before editing (3-hop BFS, risk levels)
- **`hermit_detect_changes`** — Check if code index is stale
- **`hermit_index`** — Full or incremental project indexing
- **JS/TS + Python** support via @ast-grep/napi
- **Auto-indexes** on first query — no manual setup needed
- **Incremental indexing** — only re-parses changed files via git diff

---

## Quick Start

**1. Install**
```bash
npm install -g hermit-graph
```

**2. Setup in your project**
```bash
cd /path/to/your-project
hermit setup                    # Configures ALL agents automatically (zero-config)
```

**3. Verify** — ask your agent:
> *"Do you have memory tools? Try `search_nodes` with keyword test."*

That's it. Memory is live.

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
- **Auto-recall hooks** — Before each response, agents search the brain for relevant context
- **Auto-update hooks** — After each response, entities are extracted from conversation automatically
- **Entity extraction** — 6 regex extractors catch tech decisions, error patterns, explicit refs, and more
- **14 slash commands** — `/remember`, `/recall`, `/brain-dump`, `/diagnose`, `/ingest`, etc.

### Work Across 7 Agents
- **One memory, seven agents, zero conflicts** — File-lock safe concurrent access
- **MCP protocol** — Standard integration via 28 tools + 1 resource
- **Native hooks for 5 agents** — Auto-recall and auto-update hooks for Claude, Cursor, Gemini, Cline, Codex
- **Skill distribution** — Export skills, commands, and hooks to any agent in their native format
- **Zero-config setup** — `hermit setup` configures all detected agents in one command

### Visualize & Audit
- **HTML dashboard** — vis.js graph viewer with search, filter, dark theme
- **Brain health check** — 5-check scoring (stale, dupes, orphans, low-confidence, missing relations). Score 0-100
- **Neo4j (optional)** — Full graph database with Cypher queries via Docker

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
| Code intelligence | auto | auto | auto | auto | auto | auto | auto |
| Skills (6) | auto | export | export | -- | export | export | export |
| Slash commands (14) | auto | export | export | -- | -- | export | export |
| Auto-recall hook | auto | export | export | -- | export | export | export |
| Auto-update hook | auto | export | export | -- | export | export | export |
| Rules file | auto | auto | auto | auto | -- | -- | auto |
| BUSINESS.md template | auto | auto | auto | auto | auto | auto | auto |

```bash
hermit setup                    # Configures ALL agents automatically (zero-config)
hermit setup --agent cursor     # Cursor only
hermit setup --agent gemini     # Gemini CLI only
hermit setup --agent windsurf   # Windsurf only
hermit setup --agent cline      # Cline (VS Code extension) only
hermit setup --agent codex      # OpenAI Codex CLI only
hermit setup --agent opencode   # OpenCode only
hermit setup --mcp-only         # Any agent — just prints MCP config
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

Hermit v6 includes built-in code analysis powered by [ast-grep](https://ast-grep.github.io/). No external tools, no subprocesses — just fast, in-process AST parsing.

### How It Works

```
Your Project  -->  ast-grep parser  -->  CodeGraph (symbols + relations)
                                              |
                                    data/code-symbols.jsonl
                                              |
                         query / context / impact / detect_changes
```

### MCP Tools

| Tool | What it does | Example |
|------|-------------|---------|
| `hermit_query` | Find code by concept | `hermit_query({query: "auth validation"})` |
| `hermit_context` | 360-degree view of a symbol | `hermit_context({name: "validateUser"})` |
| `hermit_impact` | Blast radius before editing | `hermit_impact({target: "connectDB", direction: "upstream"})` |
| `hermit_detect_changes` | Check if index is stale | `hermit_detect_changes()` |
| `hermit_index` | Full project reindex | `hermit_index({cwd: "/path/to/project"})` |
| `hermit_unified_search` | Search KG + code together | `hermit_unified_search({query: "payment", cwd: "/project"})` |

### Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | **WILL BREAK** — direct callers/importers | MUST update these |
| d=2 | **LIKELY AFFECTED** — indirect deps | Should test |
| d=3 | **MAY NEED TESTING** — transitive | Test if critical path |

### Languages Supported

- **JavaScript** (.js, .mjs, .cjs)
- **TypeScript** (.ts, .tsx)
- **Python** (.py) — via optional `@ast-grep/lang-python`

### Performance

| Operation | Time |
|-----------|------|
| Full index (85 files) | ~2s |
| Query | <10ms |
| Impact analysis | <20ms |
| Process detection | ~50ms |

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
hermit view               # Open dashboard viewer on localhost

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
npm test                  # Run test suite (100 tests)
npm run health            # Brain health check
npm run sync              # Sync graph to Neo4j
npm run view              # Serve HTML dashboard
npm run build:index       # Build semantic embedding index
npm run export            # Export MCP DB to brain.jsonl
npm run stale             # Stale observation report
npm run migrate           # Migrate v3 to v4 format
npm run setup             # Setup Hermit Graph for a new project
npm run setup:semantic    # Setup semantic search (JS-native)
npm run setup:all         # Setup everything (project + semantic)
```

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
<summary><strong>Auto-Update Hook (v5+)</strong></summary>

Scans assistant messages after each response and extracts entities via regex — no LLM re-parse needed. Entities written with `[0.5|date]` confidence (auto-extracted, unverified).

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
<summary><strong>Neo4j Viewer</strong></summary>

```bash
cd docker && docker compose up -d
cp .env.example .env    # set password
npm run sync
# Open http://localhost:7474
```

</details>

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
│   ├── hermit-mcp-server.mjs    # MCP server (28 tools + 1 resource)
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
├── viewer/index.html            # Graph dashboard (vis.js)
├── docker/docker-compose.yml    # Neo4j (optional)
├── templates/                   # CLAUDE.md, BUSINESS.md templates
└── package.json                 # v6.0.0
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

## Changelog (v6.0.0)

### Breaking Changes
- **Removed GitNexus dependency** — All code intelligence is now built-in via ast-grep
- **Deleted `gitnexus-runner.mjs`** — 296 LOC subprocess manager replaced by in-process analysis
- **`@ast-grep/napi`** added as bundled dependency (napi-rs prebuilt binaries, no node-gyp)

### New
- **10 code-intel modules** in `scripts/lib/code-intel/` — parser, extractors (JS/TS + Python), graph, impact, indexer, process detector
- **Auto-indexing** — CodeGraph tools auto-index on first query if no index exists
- **Incremental indexing** — Only re-parses files changed since last git commit
- **Process detection** — Discovers execution flows via DFS call chain tracing
- **Unified search** — `hermit_unified_search` merges KG entities + code symbols in one query

### Improved
- **100 tests passing** (up from 98)
- **MCP server** boots with all 28 tools, zero external dependencies
- **Performance** — Full index ~2s, queries <10ms, impact <20ms

---

## License

**MIT License** — Hermit Graph is free and open source. All dependencies are MIT or permissive licensed.

---

<p align="center">
  Built for developers who want their AI agents to actually learn.
</p>
