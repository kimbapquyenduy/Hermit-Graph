# Claude Code Brain — Persistent Memory for Claude Code

Give Claude Code a **shared brain** that remembers across all your projects. Built on a Knowledge Graph with 4-tier organization.

## Setup (3 steps)

### 1. Clone & install

```bash
git clone https://github.com/kimbapquyenduy/claude-code-brain.git
cd claude-code-brain
npm install
```

### 2. Configure global settings

Create `~/.claude/settings.json` (or merge into your existing one):

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@sockeye44/better-memory-mcp"],
      "env": {
        "MEMORY_FILE_PATH": "<YOUR_PATH>/claude-code-brain/data/brain.jsonl",
        "HF_HUB_DISABLE_SYMLINKS_WARNING": "1"
      }
    }
  }
}
```

Replace `<YOUR_PATH>` with the absolute path where you cloned the repo. Use forward slashes on all platforms.

### 3. Verify

Open any project with Claude Code and ask: *"Do you have memory tools? Try `search_nodes` with keyword test."*

If it responds with memory tools — you're done.

---

## Optional Enhancements

### Add conventions server (auto-learn project patterns)

Requires [uv](https://docs.astral.sh/uv/). Add to your `mcpServers`:

```json
"conventions": {
  "command": "uvx",
  "args": ["enhanced-mcp-memory"],
  "env": {
    "LOG_LEVEL": "INFO",
    "MAX_MEMORY_ITEMS": "500",
    "DATA_DIR": "<YOUR_PATH>/claude-code-brain/data/conventions"
  }
}
```

### Add Stop Hook (auto-save enforcement)

Add to your `~/.claude/settings.json`. This runs after every Claude Code response and reminds it to save new knowledge — nothing gets forgotten.

```json
"hooks": {
  "Stop": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Review the conversation. Check if assistant learned NEW knowledge in these 4 tiers:\n\nTier 1 BIZ: business rules, flows, entities, domain\nTier 2 PATTERN: code/arch/integration patterns\nTier 3 TECH: stack, config, people, decisions\nTier 4 INCIDENT: bugs, gotchas\n\nNaming: TIER:SCOPE:LABEL (e.g. RULE:ShopX:DiscountMax50)\nObservations MUST use [confidence|YYYY-MM-DD] prefix.\n\nIf NEW knowledge found: list each item and remind assistant to save using create_entities + create_relations.\nIf nothing new: respond exactly PASS"
        }
      ]
    }
  ]
}
```

### Copy global instructions

Copy `templates/global-CLAUDE.md` to `~/.claude/CLAUDE.md`. This teaches Claude Code the 4-tier naming convention and auto-save rules.

### Enable semantic search (for large brains, >500 entities)

```bash
npm run setup:semantic   # Installs Python + PyTorch (~500MB)
```

Then switch memory config to use the launcher:
```json
"memory": {
  "command": "node",
  "args": ["<YOUR_PATH>/scripts/launch-memory-mcp.mjs"],
  "env": {
    "MEMORY_FILE_PATH": "<YOUR_PATH>/data/brain.jsonl",
    "HF_HUB_DISABLE_SYMLINKS_WARNING": "1"
  }
}
```

---

## How It Works

```
~/.claude/settings.json    ← MCP server config (global)
~/.claude/CLAUDE.md        ← Brain instructions (global)
       ↓
Open ANY project → claude → brain is active
       ↓
Claude reads/writes → data/brain.jsonl (one shared file)
```

## 4-Tier Naming

| Tier | Prefix | Example |
|------|--------|---------|
| **BIZ** | `BIZ:`, `RULE:`, `FLOW:`, `ENTITY:` | `RULE:ShopX:DiscountMax50` |
| **PATTERN** | `PATTERN:`, `PATTERN:ARCH:`, `PATTERN:INT:` | `PATTERN:INT:VNPay` |
| **TECH** | `TECH:`, `PERSON:`, `DECISION:` | `TECH:EduMVP` |
| **INCIDENT** | `INCIDENT:`, `GOTCHA:`, `BUG:` | `BUG:RLS:20260325` |

## Commands (12)

| Command | What it does |
|---------|-------------|
| `/remember` | Save info to memory |
| `/recall` | Search saved info |
| `/brain-dump` | End-of-session save-all |
| `/brain-health` | Health check, score 0-100 |
| `/impact` | Analyze blast radius before code changes |
| `/biz-review` | Review code against business rules |
| `/biz-init` | Create BUSINESS.md for new project |
| `/diagnose` | Debug with root cause analysis |
| `/ingest` | Ingest docs (BRD/PRD/README) into KG |
| `/tech-decision` | Record tech decisions |
| `/learn-project` | Auto-detect project conventions |
| `/suggest-reuse` | Find reusable patterns from other projects |

## Viewing the Graph

**HTML Viewer (no Docker):** Open `viewer/index.html` → Click "Load File" → Select `data/brain.jsonl`

**Neo4j (Docker):**
```bash
cd docker && docker compose up -d
cp .env.example .env   # set password: brainpassword
npm run sync
# Open http://localhost:7474
```

## NPM Scripts

```bash
npm test           # Run tests
npm run health     # Brain health check (score 0-100)
npm run sync       # Sync brain → Neo4j
npm run view       # Serve HTML viewer on localhost
npm run migrate    # Migrate v1 → v2 format
npm run backfill   # Add confidence prefix to legacy data
npm run stale      # Report stale observations
npm run setup      # Setup biz-guard for a project
npm run setup:all  # Setup semantic + conventions + project
```

## Project Structure

```
claude-code-brain/
├── data/
│   ├── brain.jsonl           ← Memory file (Claude writes here)
│   ├── brain-sample.jsonl    ← Sample data
│   └── conventions/          ← Auto-learned conventions (SQLite)
├── scripts/                  ← All utility scripts
├── viewer/index.html         ← Graph viewer (vis.js, dark theme)
├── docker/docker-compose.yml ← Neo4j (optional)
├── templates/                ← Templates for CLAUDE.md, BUSINESS.md
├── mcp-memory-libsql/       ← LibSQL-based memory MCP server
├── .claude/                  ← Skills, commands, workflows, hooks
├── .claude-settings.json     ← Config template (MCP + hooks)
└── .mcp.json                 ← MCP server config (local)
```

## FAQ

**Claude Code doesn't remember anything?**
Check `~/.claude/settings.json` exists, JSON is valid, `MEMORY_FILE_PATH` is correct. Restart Claude Code after changes.

**Viewer shows nothing?**
Make sure `data/brain.jsonl` has data. If `file://` is blocked, use `npm run view`.

**Want to reset?**
Clear contents of `data/brain.jsonl` (keep file, delete contents).

**Brain file too large?**
Works fine up to several MB. Over 10MB, consider archiving old entries.

---

> Built on [ClaudeKit Engineer](https://github.com/claudekit/claudekit-engineer). Ships with 47+ dev skills — see `.claude/skills/`.
