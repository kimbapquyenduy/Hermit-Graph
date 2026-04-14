<p align="center">
  <img src="https://img.shields.io/npm/v/hermit-graph?style=flat-square&color=blue" alt="npm version" />
  <img src="https://img.shields.io/github/stars/kimbapquyenduy/hermit-graph?style=flat-square&logo=github" alt="GitHub stars" />
  <img src="https://img.shields.io/badge/agents-Claude%20%7C%20Cursor%20%7C%20Gemini%20%7C%20Cline%20%7C%20Codex-blueviolet?style=flat-square" alt="Supported agents" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/MCP-v1.29-orange?style=flat-square" alt="MCP Protocol" />
</p>

# Hermit Graph

**Your AI coding agents remember what they learned — across projects, across time.**

One persistent memory for Claude Code, Cursor, Gemini CLI, Cline, and Codex. Install once, every agent stays in context.

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
You → AI Agent → Hermit Brain (brain.jsonl)
                     ↕
              Search · Recall · Learn
                     ↕
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
hermit setup                    # Auto-detects your AI agent
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

### Enforce Business Rules
- **Business rule guard** — `/biz-review` validates code against documented rules before merge
- **Impact analysis** — `/impact` shows blast radius before you change anything
- **Cross-project reuse** — `/suggest-reuse` finds reusable patterns from your other projects

### Automate Knowledge Capture
- **Auto-recall hooks** — Before each response, agents search the brain for relevant context
- **Auto-update hooks** — After each response, entities are extracted from conversation automatically
- **Entity extraction** — 6 regex extractors catch tech decisions, error patterns, explicit refs, and more
- **14 slash commands** — `/remember`, `/recall`, `/brain-dump`, `/diagnose`, `/ingest`, etc.

### Work Across 5 Agents
- **One memory, five agents, zero conflicts** — File-lock safe concurrent access
- **MCP protocol** — Standard integration via 28 tools + 1 resource
- **Native hooks for all agents** — Auto-recall and auto-update hooks for Claude, Cursor, Gemini, Cline, Codex
- **Skill distribution** — Export skills, commands, and hooks to any agent in their native format

### Visualize & Audit
- **HTML dashboard** — vis.js graph viewer with search, filter, dark theme
- **Brain health check** — 5-check scoring (stale, dupes, orphans, low-confidence, missing relations). Score 0-100
- **Neo4j (optional)** — Full graph database with Cypher queries via Docker

---

## Why Hermit Graph?

| | Hermit Graph | CLAUDE.md (manual) | Git Notes | Linear / Notion |
|---|:---:|:---:|:---:|:---:|
| **Searchable** | Semantic + keyword | Manual search | Limited | External |
| **Multi-agent** | 5 agents, file-lock safe | Per-project | Per-branch | Per-workspace |
| **Structured** | 4-tier taxonomy, 13 types | Unstructured | Unstructured | Manual structure |
| **Auto-capture** | Hooks extract entities | Manual save | Manual | Manual |
| **Works offline** | Local JSONL | Local | Local | Needs internet |
| **Cost** | Free (MIT) | Free | Free | $10-20/mo |

---

## Agent Support

| Feature | Claude Code | Cursor | Gemini CLI | Cline | Codex |
|---------|:-----------:|:------:|:----------:|:-----:|:-----:|
| MCP memory server | auto | auto | auto | manual | manual |
| brain.jsonl | auto | auto | auto | auto | auto |
| Skills (6) | auto | export | export | export | export |
| Slash commands (14) | auto | export | export | — | export |
| Auto-recall hook | auto | export | export | export | export |
| Auto-update hook | auto | export | export | export | export |
| BUSINESS.md template | auto | auto | auto | auto | auto |

```bash
hermit setup                    # Auto-detect (defaults to Claude Code)
hermit setup --agent cursor     # Cursor
hermit setup --agent gemini     # Gemini CLI
hermit setup --agent cline      # Cline (VS Code extension)
hermit setup --agent codex      # OpenAI Codex CLI
hermit setup --mcp-only         # Any agent — just prints MCP config
```

> Claude Code gets native `.claude/` integration. Other agents get the same features via `hermit hooks export` and `hermit skills export` in their native formats.

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
| Cline | VS Code `settings.json` → `cline.mcpServers` |
| Codex | `~/.codex/config.json` |

</details>

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
hermit hooks export --all --agent all --project /path       # Hooks to all agents
```

<details>
<summary><strong>NPM Scripts</strong></summary>

```bash
npm test                  # Run test suite (98 tests)
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
<summary><strong>Auto-Update Hook (v5)</strong></summary>

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
│   └── hooks/                   # Auto-recall + auto-update hooks (5 agents)
│       ├── kg-auto-recall*.cjs  # Pre-response context recall
│       ├── kg-auto-update*.cjs  # Post-response entity extraction
│       ├── session-hook-*.cjs   # Session start hooks
│       └── lib/                 # Shared hook logic
├── data/
│   ├── brain.jsonl              # Knowledge graph data
│   ├── brain-embeddings.json    # Semantic search index
│   └── conventions/             # Auto-learned conventions
├── scripts/
│   ├── brain-cli.mjs            # CLI entry point
│   ├── skills-manager.mjs       # Skill install/remove/list/export
│   ├── hermit-mcp-server.mjs    # MCP server (28 tools + 1 resource)
│   └── lib/                     # 12 modules
├── viewer/index.html            # Graph dashboard (vis.js)
├── docker/docker-compose.yml    # Neo4j (optional)
├── templates/                   # CLAUDE.md, BUSINESS.md templates
└── package.json                 # v5.0.0
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

---

<p align="center">
  <strong>MIT License</strong> · Built for developers who want their AI agents to actually learn.
</p>
