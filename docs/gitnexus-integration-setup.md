# GitNexus + Memory MCP Integration Setup

> Quick guide to run GitNexus alongside claude-code-brain memory server
> Time: ~5 minutes

---

## TL;DR

```bash
# 1. Index your repo
cd /path/to/your/project
npx gitnexus analyze

# 2. Setup MCP (one-time, auto-detects editors)
npx gitnexus setup

# 3. Restart Claude Code → both tools available
```

---

## settings.json config (manual)

Add `gitnexus` alongside existing `memory` server in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@sockeye44/better-memory-mcp"],
      "env": {
        "MEMORY_FILE_PATH": "D:/AI/claude-code-brain/data/brain.jsonl"
      }
    },
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"]
    }
  }
}
```

> Zero conflicts — MCP protocol auto-namespaces tools from each server.

---

## Tools available after setup

| Server | Tools | When to use |
|--------|-------|-------------|
| **memory** | search_nodes, create_entities, open_nodes... | Business rules, decisions, patterns |
| **gitnexus** | query, impact, context, detect_changes, cypher... | Call graph, blast radius, execution flow |

---

## Key facts

- **Multi-repo:** 1 MCP server serves all repos (global `~/.gitnexus/registry.json`)
- **Per-repo cost:** Run `npx gitnexus analyze` once per repo, then incremental
- **Size:** `.gitnexus/` = 200MB–2GB → add to `.gitignore`
- **No server needed:** Fully local, zero-upload

---

## Add more repos

```bash
cd /another/project
npx gitnexus analyze
# Auto-registered. Same MCP server serves all.
```

---

## Common errors

| Error | Fix |
|-------|-----|
| `command not found: npx` | Install Node.js 20+ |
| MCP icon missing | Quit + reopen Claude Code completely |
| Config syntax error | Validate at jsonlint.com |
| `.gitnexus/` is huge | Normal — add to `.gitignore` |

---

## Verify it works

In Claude Code chat:
```
Show me the indexed repositories
```
Claude should call `list_repos` and return your indexed repos.

---

## Combined workflow

```
User: "Add discount validation to checkout"

1. memory recall    → RULE:DiscountMax50, PATTERN:CheckoutFlow
2. gitnexus impact  → "applyDiscount() has 4 callers, HIGH risk"
3. Agent codes with full context: knows the RULE + knows the RISK
```

---

## Reference docs

- Full analysis: `plans/reports/researcher-260328-1327-gitnexus-analysis.md`
- MCP deep dive: `plans/reports/researcher-260328-1429-gitnexus-mcp-integration.md`
- Config templates: `plans/reports/researcher-260328-1429-config-templates.md`
- Comparison: `docs/gitnexus-vs-brain-comparison.md`
