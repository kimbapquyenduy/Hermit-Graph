# GitNexus + Memory Server Quick Setup Guide

**For:** Claude Code on Windows/macOS/Linux
**Time:** ~5 minutes
**Complexity:** Low

---

## TL;DR

```bash
# 1. Index your repo
npx gitnexus analyze

# 2. Setup MCP (one-time)
npx gitnexus setup

# 3. Restart Claude Code

# 4. Done! Both GitNexus + Memory tools available
```

---

## STEP-BY-STEP

### Step 1: Index Your Repository

```bash
cd /path/to/your/repo
npx gitnexus analyze
```

**What this does:**
- Creates `.gitnexus/` directory (gitignored)
- Builds code graph (takes 30-60s for typical repos)
- Registers repo in `~/.gitnexus/registry.json`
- Creates `AGENTS.md`, `CLAUDE.md`, `GUARDRAILS.md`

**Output:** Should see "✓ Index created" or similar.

---

### Step 2: Configure MCP (One-Time)

```bash
npx gitnexus setup
```

**What this does:**
- Auto-detects your editors (Claude Code, Cursor, etc.)
- Writes MCP config to correct location
- Tests the configuration

**Output:** Success message with config file path.

---

### Step 3: Configure Memory Server (Optional)

**If you don't have memory server yet:**

```bash
# Via Claude Code CLI
claude mcp add memory -- npx -y @modelcontextprotocol/server-memory@latest
```

**If you want to manually edit:**

Find and edit your MCP config file:

**Claude Code:**
```bash
# macOS/Linux
~/.claude/mcp.json

# Windows
%APPDATA%\Claude\mcp.json
```

**Edit to include both servers:**
```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"]
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory@latest"]
    }
  }
}
```

---

### Step 4: Restart Claude Code

1. **Completely quit** Claude Code
2. **Restart** Claude Code
3. Look for ⚙️ icon in bottom-right (MCP indicator)
4. Click icon → see "gitnexus" and "memory" servers listed

---

## VERIFY IT WORKS

In Claude Code, type:

```
Show me the indexed repositories
```

Claude should respond with the output of `gitnexus list_repos` tool.

---

## COMMON ERRORS & FIXES

| Error | Fix |
|-------|-----|
| `command not found: npx` | Install Node.js 20+ |
| `gitnexus setup` not found | Run `npm install -g gitnexus` first |
| MCP icon doesn't appear | Restart Claude Code completely (quit + reopen) |
| Config file syntax error | Validate JSON: use [jsonlint.com](https://jsonlint.com) |
| `.gitnexus/` is huge | Normal (200MB-2GB for large repos); add to `.gitignore` |

---

## NEXT STEPS

**Use the tools:**
- `query("search term")` — Find code
- `context("symbol")` — See all references
- `impact("function")` — Blast radius analysis
- `rename("old", "new")` — Coordinated refactoring

**Index more repos:**
```bash
cd /another/repo
npx gitnexus analyze
```

Single MCP server serves all indexed repos automatically.

**Update stale index:**
```bash
gitnexus analyze --force  # Full re-index
gitnexus analyze          # Incremental
```

---

## FILE LOCATIONS

| File/Dir | Purpose | Location |
|----------|---------|----------|
| MCP Config | Servers config | `~/.claude/mcp.json` |
| Registry | Indexed repos | `~/.gitnexus/registry.json` |
| Index | Per-repo data | `.gitnexus/` (in each repo) |
| Logs | Debug info | `%APPDATA%\Claude\logs\mcp*.log` |

---

**Done!** You now have GitNexus code intelligence + Memory persistencerunning in Claude Code.
