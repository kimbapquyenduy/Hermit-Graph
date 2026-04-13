# Hermit Graph — Persistent Memory for AI Coding Agents

A **knowledge graph** that gives your AI coding agents long-term memory across all projects. Built on a 4-tier taxonomy with confidence-scored observations, semantic search, and multi-agent support.

> *The Hermit carries a lantern to illuminate hidden truths — this graph carries your codebase wisdom.*

## Features

### Core
- **4-Tier Knowledge Graph** — Structured taxonomy: BIZ (business), PATTERN (code/arch), TECH (stack/config), INCIDENT (bugs/gotchas)
- **Confidence-Scored Observations** — Every fact tagged `[confidence|date]` (0.0-1.0). Stale entries auto-flagged after 180 days
- **13 Entity Types** — `biz-domain`, `biz-rule`, `biz-flow`, `biz-entity`, `pattern-code`, `pattern-arch`, `pattern-integration`, `tech-stack`, `tech-config`, `tech-person`, `tech-decision`, `incident-bug`, `incident-gotcha`
- **JSONL Storage** — Git-friendly, zero database. One shared file across all projects

### Search
- **Hybrid Search** — Semantic (vector) + keyword (BM25-like) via `hermit search`
- **JS-Native Embeddings** — transformers.js + all-MiniLM-L6-v2 ONNX (~23MB, offline, no Python)
- **Embedding Index** — Pre-built vector index for fast similarity search

### Intelligence
- **Brain Health Check** — 5-check scoring system (stale, dupes, orphans, low-confidence, missing relations). Score 0-100
- **Business Rule Guard** — `/biz-review` validates code against documented business rules
- **Impact Analysis** — `/impact` shows blast radius before code changes
- **Cross-Project Reuse** — `/suggest-reuse` finds reusable patterns from other projects

### Multi-Agent
- **File-Lock Coordination** — Multiple AI agents can read/write the same brain.jsonl safely
- **MCP Protocol** — Any MCP-compatible agent connects (Claude Code, Cursor, Codex, etc.)
- **Auto-Save Hooks** — Stop hook reviews every response and reminds agent to save new knowledge

### Visualization
- **HTML Dashboard** — vis.js graph viewer with search, filter, dark theme. No build tools needed
- **Neo4j (Optional)** — Full graph database with Cypher queries via Docker

### Skill Distribution
- **Multi-Agent Export** — Export skills to Claude Code, Cursor, Gemini CLI, Codex in their native formats
- **Write Strategies** — Per-file (Claude `.claude/skills/`, Cursor `.mdc`), merge-single (Gemini `GEMINI.md`, Codex `AGENTS.md`)
- **Idempotent Merge** — Section markers for merge-single agents ensure re-export replaces, not duplicates
- **MCP Tools** — `hermit_skill_list` and `hermit_skill_export` callable from any agent

### Developer Tools
- **14 Slash Commands** — `/remember`, `/recall`, `/brain-dump`, `/diagnose`, `/ingest`, and more
- **6 Skills** — Business guard, auto-memory, code patterns, API design, DB migrations, tech advisor
- **Hermit CLI** — `hermit skills`, `hermit search`, `hermit health`, `hermit index`, etc.

---

## Setup

### 1. Install

**Option A: npm (recommended)**
```bash
npm install -g hermit-graph
```

**Option B: git clone**
```bash
git clone https://github.com/kimbapquyenduy/hermit-graph.git
cd hermit-graph
npm install && npm link
```

### 2. Setup for your AI agent

Navigate to your project and run `hermit setup`. It auto-detects your agent and configures everything.

```bash
cd /path/to/your-project
hermit setup                    # Auto-detect (defaults to Claude Code)
hermit setup --agent cursor     # Cursor
hermit setup --agent windsurf   # Windsurf
hermit setup --agent cline      # Cline (VS Code extension)
hermit setup --agent codex      # OpenAI Codex CLI
hermit setup --mcp-only         # Any agent — just prints MCP config
```

**What each agent gets:**

| Feature | Claude Code | Cursor | Windsurf | Cline | Codex |
|---------|:-----------:|:------:|:--------:|:-----:|:-----:|
| MCP memory server | auto | auto | auto | manual | manual |
| brain.jsonl | auto | auto | auto | auto | auto |
| Skills (6) | auto | export | export | — | export |
| Slash commands (14) | auto | — | — | — | — |
| Auto-recall hook | auto | — | — | — | — |
| Auto-save hook | auto | — | — | — | — |
| BUSINESS.md template | auto | auto | auto | auto | auto |

> **Why the difference?** Skills, slash commands, and hooks are Claude Code-specific features (`.claude/` directory). Other agents connect via MCP protocol only — they get the same knowledge graph, just without the Claude Code integrations. Use `hermit skills export` to distribute skills to Cursor, Gemini, and Codex in their native formats.

### 3. Verify

Open your project with your AI agent and ask: *"Do you have memory tools? Try `search_nodes` with keyword test."*

### Manual MCP setup (any agent)

If `hermit setup` can't auto-configure your agent, add this MCP server config manually:

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

**Config file locations:**
| Agent | Config path |
|-------|------------|
| Claude Code | `~/.claude/settings.json` |
| Cursor | `~/.cursor/mcp.json` or `.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline | VS Code `settings.json` → `cline.mcpServers` |
| Codex | `~/.codex/config.json` |

### Claude Code extras (optional)

For Claude Code users, `hermit setup` also installs:
- **Global instructions** (`~/.claude/CLAUDE.md`) — teaches the 4-tier naming convention
- **Auto-recall hook** — searches brain.jsonl before every response
- **Auto-save hook** — reminds agent to save new knowledge after each response

These are auto-configured by `hermit setup`. No manual steps needed.

---

## Optional: Semantic Search

Enables vector-based similarity search on top of keyword matching.

```bash
npm run setup:semantic    # Verifies Node 18+, downloads model (~23MB)
npm run build:index       # Builds embedding index from brain.jsonl
```

## Optional: Auto-Save Hook

Add to your `~/.claude/settings.json` under `"hooks"`. This runs after every AI response and prompts it to save new knowledge.

```json
"hooks": {
  "Stop": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Review the conversation. If NEW knowledge was learned (business rules, patterns, tech decisions, bugs), remind assistant to save using create_entities. If nothing new, respond PASS."
        }
      ]
    }
  ]
}
```

See `.claude-settings.json` for the full detailed hook prompt.

## Optional: Neo4j Viewer

```bash
cd docker && docker compose up -d
cp .env.example .env    # set password
npm run sync
# Open http://localhost:7474
```

---

## CLI Reference

```bash
# Skills (no ClaudeKit needed)
hermit skills                          # List all 6 skills + 14 commands
hermit skills add biz-guard api-design # Install specific skills
hermit skills add --all                # Install all skills + commands + hooks
hermit skills remove <name>            # Remove a skill
hermit skills info <name>              # Show skill details
hermit skills installed                # Show what's installed in current project

# Skill distribution (multi-agent export)
hermit skills export biz-guard --agent cursor --project /path  # Export to Cursor (MDC)
hermit skills export --all --agent gemini --global             # All skills to ~/.gemini/GEMINI.md
hermit skills export --all --agent codex --project /path       # All skills to AGENTS.md
hermit skills export biz-guard --agent all --global            # Export to all 4 agents

# Project setup (multi-agent)
hermit setup                           # Auto-detect agent, install everything
hermit setup --agent cursor            # Setup for Cursor
hermit setup --agent windsurf          # Setup for Windsurf
hermit setup --agent cline             # Setup for Cline
hermit setup --agent codex             # Setup for Codex CLI
hermit setup --mcp-only                # Just print MCP config (any agent)
hermit setup --only biz-guard,api-design  # Claude: selected skills only
hermit setup --skip db-migrations      # Claude: skip specific skills

# Knowledge graph
hermit search <query>     # Hybrid semantic + keyword search
hermit health             # Brain health check (score 0-100)
hermit index [--force]    # Build/rebuild embedding index
hermit export             # Export MCP DB to brain.jsonl
hermit stale              # Report stale observations (>180 days)
hermit serve              # Start MCP memory server
hermit view               # Open dashboard viewer on localhost
hermit help               # Show all commands
```

## NPM Scripts

```bash
npm test                  # Run test suite
npm run health            # Brain health check
npm run sync              # Sync graph to Neo4j
npm run view              # Serve HTML dashboard
npm run build:index       # Build semantic embedding index
npm run export            # Export MCP DB to brain.jsonl
npm run stale             # Stale observation report
npm run migrate           # Migrate v3 to v4 format
npm run backfill          # Add confidence prefix to legacy data
npm run setup             # Setup Hermit Graph for a new project
npm run setup:semantic    # Setup semantic search (JS-native)
npm run setup:all         # Setup everything (project + semantic)
```

## Slash Commands

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

## 4-Tier Naming

| Tier | Prefix | Example |
|------|--------|---------|
| **BIZ** | `BIZ:`, `RULE:`, `FLOW:`, `ENTITY:` | `RULE:ShopX:DiscountMax50` |
| **PATTERN** | `PATTERN:`, `PATTERN:ARCH:`, `PATTERN:INT:` | `PATTERN:INT:VNPay` |
| **TECH** | `TECH:`, `PERSON:`, `DECISION:` | `TECH:EduMVP` |
| **INCIDENT** | `INCIDENT:`, `GOTCHA:`, `BUG:` | `INCIDENT:ShopX:PaymentTimeout` |

## Project Structure

```
hermit-graph/
├── catalog/
│   ├── skills/                  # 6 hermit-graph skills (git-tracked)
│   ├── commands/                # 14 slash commands (git-tracked)
│   └── hooks/                   # Auto-save hook (git-tracked)
├── data/
│   ├── brain.jsonl              # Knowledge graph data (agents write here)
│   ├── brain-embeddings.json    # Semantic search index
│   └── conventions/             # Auto-learned conventions (SQLite)
├── scripts/
│   ├── brain-cli.mjs            # Hermit CLI entry point
│   ├── skills-manager.mjs       # Skill install/remove/list/export manager
│   ├── brain-health.mjs         # Health check (5 checks, score 0-100)
│   ├── build-embedding-index.mjs # Semantic index builder
│   ├── merge-brain-jsonl.mjs    # Multi-agent merge utility
│   ├── setup-project.mjs        # Full project setup wizard
│   ├── setup-semantic.mjs       # Semantic search setup
│   ├── sync-to-neo4j.mjs        # Neo4j sync
│   └── lib/
│       ├── skill-adapters.mjs   # Agent configs + transforms (4 agents)
│       ├── skill-export.mjs     # Export engine (discover, compat, write)
│       ├── skills-module.mjs    # MCP tools (hermit_skill_list/export)
│       ├── semantic-search.mjs  # Hybrid search engine
│       ├── embedding-service.mjs # transformers.js wrapper
│       └── file-lock.mjs        # Multi-agent write coordination
├── viewer/index.html            # Graph dashboard (vis.js, dark theme)
├── docker/docker-compose.yml    # Neo4j (optional)
├── templates/                   # CLAUDE.md, BUSINESS.md, global instructions
├── .claude-settings.json        # MCP + hooks config template
└── package.json                 # v4.1.0
```

## FAQ

**Agent doesn't remember anything?**
Check `~/.claude/settings.json` — JSON must be valid, `MEMORY_FILE_PATH` must be an absolute path to `data/brain.jsonl`. Restart your AI agent after changes.

**Viewer shows nothing?**
Make sure `data/brain.jsonl` has data. If `file://` is blocked by browser, run `npm run view`.

**Want to reset memory?**
Clear contents of `data/brain.jsonl` (keep the file, delete all lines).

**Data file too large?**
Works fine up to several MB. Over 10MB, run `hermit stale` and archive old entries.

**Semantic search not working?**
Run `npm run setup:semantic` then `npm run build:index`. Requires Node.js 18+.

---

*Formerly Claude Code Brain. Rebranded as Hermit Graph v3.0 — universal AI agent memory, not just for Claude.*
