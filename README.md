# Claude Code Brain v2.3 — Knowledge Graph Memory for Claude Code

> Copy this folder → 5 min setup → Claude Code gains persistent memory across all projects.
> Built on [ClaudeKit Engineer](https://github.com/claudekit/claudekit-engineer) boilerplate.

## Quick Start (5 min)

### Step 1: Clone / Copy
```bash
git clone https://github.com/kimbapquyenduy/claude-code-brain.git
cd claude-code-brain
```

### Step 2: Install dependencies
```bash
npm install
```

### Step 3: Global Setup (brain works in ANY project)

The brain is configured **globally** — once set up, Claude Code has memory in every project you open.

**3a. Create global settings directory:**
```bash
# Linux/Mac
mkdir -p ~/.claude

# Windows
mkdir %USERPROFILE%\.claude
```

**3b. Create `~/.claude/settings.json`** with the MCP memory server config:
```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@sockeye44/better-memory-mcp"],
      "env": {
        "MEMORY_FILE_PATH": "D:/AI/claude-code-brain/data/brain.jsonl",
        "HF_HUB_DISABLE_SYMLINKS_WARNING": "1"
      }
    }
  }
}
```

> **Important:** Replace `D:/AI/claude-code-brain` with the actual path where you cloned this repo.
> Use forward slashes `/` even on Windows.

**3c. (Optional) Copy global instructions:**

Copy `templates/global-CLAUDE.md` → `~/.claude/CLAUDE.md`

This teaches Claude Code the 4-tier naming convention, auto-save rules, and Stop Hook enforcement — so it knows *how* to use the brain properly.

**3d. (Optional) Add Stop Hook for auto-save enforcement:**

Add the `hooks` section from `.claude-settings.json` into your `~/.claude/settings.json`. The Stop Hook runs after every Claude Code response and reminds it to save new knowledge — so nothing gets forgotten.

**How it works:**
```
~/.claude/settings.json    ← MCP server config (global, all projects)
~/.claude/CLAUDE.md        ← Brain instructions (global, all projects)
       ↓
You open ANY project → `claude` → brain is active automatically
       ↓
Claude Code reads/writes → data/brain.jsonl (one shared brain file)
```

### Step 4: (Optional) Semantic Search + Auto-Learn
```bash
npm run setup:semantic     # Python + PyTorch for semantic search
npm run setup:conventions  # uv/pip for auto-learn conventions
# Or install all:
npm run setup:all
```

### Step 5: Use it
Open terminal in any project → `claude` → it remembers everything!

## Viewing the Knowledge Graph

### Option A: HTML Viewer (simplest, no Docker)
Open `viewer/index.html` → Click "Load File" → Select `data/brain.jsonl`

### Option B: Neo4j Browser (richer, needs Docker)
1. Install Docker Desktop
2. `cd docker && docker compose up -d`
3. Open http://localhost:7474
4. Copy `.env.example` → `.env`, set password (`brainpassword`)
5. `npm run sync` → Data flows into Neo4j

## Daily Usage
1. Open Claude Code in any project → it auto-recalls context from all projects
2. End of day: open `viewer/index.html` to see what the brain learned
3. (Optional) `npm run sync` to push data into Neo4j for richer graph visualization

## 4-Tier Naming Convention

| Tier | Prefix | EntityTypes | Example |
|------|--------|-------------|---------|
| BIZ | `BIZ:`, `RULE:`, `FLOW:`, `ENTITY:` | biz-domain, biz-rule, biz-flow, biz-entity | `BIZ:ShopX`, `RULE:ShopX:DiscountMax50` |
| PATTERN | `PATTERN:`, `PATTERN:ARCH:`, `PATTERN:INT:` | pattern-code, pattern-arch, pattern-integration | `PATTERN:JWTRefresh`, `PATTERN:INT:VNPay` |
| TECH | `TECH:`, `PERSON:`, `DECISION:` | tech-stack, tech-config, tech-person, tech-decision | `TECH:EduMVP`, `PERSON:AnhMinh` |
| INCIDENT | `INCIDENT:`, `GOTCHA:`, `BUG:` | incident-bug, incident-gotcha | `BUG:RLS:20260325`, `GOTCHA:PrismaEnum` |

## Brain Commands (12)

| Command | Description |
|---------|-------------|
| `/impact` | Analyze blast radius before code changes |
| `/biz-review` | Review code against business rules |
| `/biz-init` | Create BUSINESS.md for a new project |
| `/remember` | Save info to memory (v2 naming) |
| `/recall` | Search saved information |
| `/brain-dump` | End-of-session summary, save everything |
| `/diagnose` | Systematic debugging, save incident |
| `/ingest` | Ingest files (BRD/PRD/README) into KG |
| `/tech-decision` | Record technical decisions |
| `/learn-project` | Auto-detect project conventions |
| `/suggest-reuse` | Suggest reusable patterns from other projects |
| `/brain-health` | 5 automated health checks, score 0-100 |

## Brain Skills (7)

| Skill | Description |
|-------|-------------|
| auto-memory | Save/recall management with 4-tier schema |
| biz-guard | Check business impact before coding |
| code-patterns | Detect & save coding patterns |
| api-design | Consistent API design guidance |
| db-migrations | Safe database migration practices |
| security-check | Security review checklist |
| tech-advisor | Tech stack comparison & advice |

> **Note:** This project ships with 47+ additional skills via ClaudeKit (frontend, backend, DevOps, etc.). See `.claude/skills/` for the full list.

## Features

### Confidence & Temporal (v2.1)
- Observation prefix: `[confidence|YYYY-MM-DD]` — required for all new observations
- Stale detection: observations >180 days → flagged for review
- Decay formula: `confidence * e^(-0.01 * days)`
- Tools: `npm run backfill` (add prefix to legacy data), `npm run stale` (stale report)

### Semantic Search (v2.2)
- MCP server: `@sockeye44/better-memory-mcp` (drop-in replacement, 15 tools)
- ModernColBERT neural embeddings — search "authentication patterns" → finds `PATTERN:JWTAuth`
- Requires: Python 3.8+, PyTorch (~500MB model). Falls back to keyword search without Python
- **Default: OFF** (`search_nodes` + Claude is sufficient for <500 entities)

#### Enable Semantic Search (>500 entities):
Switch memory config in `~/.claude/settings.json` from npx to launcher:
```json
"memory": {
  "command": "node",
  "args": ["<path>/scripts/launch-memory-mcp.mjs"],
  "env": {
    "MEMORY_FILE_PATH": "<path>/data/brain.jsonl",
    "HF_HUB_DISABLE_SYMLINKS_WARNING": "1"
  }
}
```
Restart Claude Code session after changing config.

### Auto-Learn Conventions (v2.2)
- Secondary MCP server: `enhanced-mcp-memory` (SQLite, runs in parallel)
- Auto-detects: naming conventions, import styles, build tools, linting
- Command `/learn-project` — scan project, detect conventions, save as `PATTERN:ARCH:*`
- Setup: `npm run setup:conventions`

### Cross-Project Intelligence (v2.2)
- Command `/suggest-reuse` — find patterns from other projects that can be reused
- Ranked by confidence score, filtered by decay threshold 0.3
- Links patterns to current project via `uses_pattern` relation

### Brain Hygiene (v2.3)
- Command `/brain-health` — 5 automated checks, health score 0-100
- Checks: stale entries, duplicates, orphan nodes, low confidence, missing relations
- Viewer: health badge in header bar (color-coded score)
- CLI: `npm run health`

## NPM Scripts

```bash
npm test              # 11 tests (JSONL, entities, settings, viewer, skills, health...)
npm run sync          # Sync brain.jsonl → Neo4j (needs Docker)
npm run view          # Serve HTML viewer on localhost:3000
npm run migrate       # Migrate brain.jsonl from v1 to v2
npm run backfill      # Add [confidence|date] prefix to legacy data
npm run stale         # Report stale observations
npm run health        # Brain health check (score 0-100)
npm run setup         # Setup biz-guard for a new project
npm run setup:all     # Setup semantic + conventions + project
```

## Project Structure

```
claude-code-brain/
├── data/
│   ├── brain.jsonl              ← Memory file (Claude Code writes here)
│   ├── brain-sample.jsonl       ← Sample data (v2 format)
│   └── conventions/             ← Auto-learned conventions (SQLite)
├── scripts/
│   ├── sync-to-neo4j.mjs        ← Sync brain → Neo4j
│   ├── test.mjs                 ← Test script (11 tests)
│   ├── brain-health.mjs         ← Brain health check (v2.3)
│   ├── setup-project.mjs        ← Setup biz-guard for new project
│   ├── setup-semantic.mjs       ← Setup Python + PyTorch
│   ├── setup-conventions.mjs    ← Setup uv + enhanced-mcp-memory
│   ├── backfill-confidence.mjs  ← Backfill [confidence|date] prefix
│   ├── stale-report.mjs         ← Report stale observations
│   ├── migrate-brain-v1-to-v2.mjs ← Migration script v1→v2
│   ├── launch-memory-mcp.mjs    ← MCP launcher with semantic search
│   └── lib/                     ← Shared modules
├── viewer/
│   └── index.html               ← Graph viewer (vis.js, dark theme)
├── docker/
│   └── docker-compose.yml       ← Neo4j (optional)
├── templates/
│   ├── global-CLAUDE.md         ← Template for ~/.claude/CLAUDE.md
│   ├── BUSINESS.md              ← Template business impact map
│   └── CLAUDE-project.md        ← Template per-project instructions
├── .claude/                     ← ClaudeKit boilerplate (skills, commands, workflows)
│   ├── skills/                  ← 47+ skills (brain + general dev)
│   ├── commands/                ← 40+ commands (brain + general dev)
│   ├── workflows/               ← Development workflows
│   ├── hooks/                   ← Git & editor hooks
│   └── agents/                  ← Specialized agent configs
├── .claude-settings.json        ← Config template (Dual MCP + Stop Hook)
├── .env.example                 ← Neo4j config template
├── package.json
├── GUIDE.md                     ← Detailed setup guide & use cases
└── README.md
```

## Migration from v1
If you have an existing brain.jsonl (v1 format):
```bash
npm run migrate
```
Script auto-converts entity names + entityTypes to v2 format.

## FAQ

**Q: Claude Code doesn't remember anything?**
A: Check `~/.claude/settings.json` exists, JSON format is valid, `MEMORY_FILE_PATH` points to correct location. Restart Claude Code after editing.

**Q: Viewer shows nothing?**
A: Check `data/brain.jsonl` has data. Use `brain-sample.jsonl` to test. If `file://` is blocked, run `npm run view`.

**Q: Neo4j sync fails?**
A: Check Docker is running (`docker ps`), `.env` has correct password (`brainpassword`).

**Q: Want to reset brain?**
A: Clear contents of `data/brain.jsonl` (keep the file, delete contents).

**Q: Brain file too large?**
A: MCP Memory Server handles files up to several MB. If >10MB, consider archiving old entries.
