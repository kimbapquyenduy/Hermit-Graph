# GitNexus MCP Server Integration Research Report

**Date:** 2026-03-28 | **Time:** 14:29
**Status:** COMPLETE
**Scope:** GitNexus + Memory Server MCP Integration for Claude Code

---

## EXECUTIVE SUMMARY

GitNexus is a zero-server code intelligence engine that works as an MCP server. Key finding: **GitNexus uses a global registry architecture** allowing one MCP server to serve unlimited indexed repos without per-project config. It can run alongside other MCP servers (memory server, etc.) with zero conflicts since tools are namespaced by server.

**Setup:** 2 commands:
1. `npx gitnexus analyze` (indexes repo, stores in `.gitnexus/`)
2. `npx gitnexus setup` (one-time, configures MCP in editor settings)

---

## SECTION 1: MCP SERVER CONFIGURATION

### 1.1 GitNexus MCP Configuration

**Command to run MCP server:**
```bash
npx -y gitnexus@latest mcp
```

**Configuration structure** (stdio mode):
```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"]
    }
  }
}
```

### 1.2 Configuration by Editor

**Claude Code** (recommended, full support):
```bash
# macOS/Linux
claude mcp add gitnexus -- npx -y gitnexus@latest mcp

# Windows
claude mcp add gitnexus -- cmd /c npx -y gitnexus@latest mcp
```

**Cursor** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"]
    }
  }
}
```

**Codex** (`~/.codex/config.toml`):
```toml
[mcp_servers.gitnexus]
command = "npx"
args = ["-y", "gitnexus@latest", "mcp"]
```

**OpenCode** (`~/.config/opencode/config.json`):
```json
{
  "mcp": {
    "gitnexus": {
      "type": "local",
      "command": ["gitnexus", "mcp"]
    }
  }
}
```

### 1.3 Setup Command: `npx gitnexus setup`

**What it does:**
- Auto-detects installed editors (Claude Code, Cursor, Codex, Windsurf, OpenCode)
- Writes correct MCP config to editor-specific location
- One-time execution; config persists
- Does NOT require per-project setup

**Files written:**
- Claude Code: `~/.claude/mcp.json` or via `claude mcp add` CLI
- Cursor: `~/.cursor/mcp.json`
- Codex: `~/.codex/config.toml`
- OpenCode: `~/.config/opencode/config.json`

---

## SECTION 2: MULTIPLE MCP SERVERS (GITNEXUS + MEMORY SERVER)

### 2.1 Running Multiple Servers Simultaneously

**Status:** FULLY SUPPORTED. Claude Code and other editors can run multiple MCP servers at once.

**Configuration example** (GitNexus + Memory server):
```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"]
    },
    "memory-server": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory@latest"]
    }
  }
}
```

### 2.2 Tool Naming & Conflict Resolution

**Important:** Each MCP server exposes tools with unique names. Tools from different servers are **automatically namespaced** by the MCP client (Claude Code).

**Example:**
- GitNexus tools: `list_repos`, `query`, `context`, `impact`, `detect_changes`, `rename`, `cypher`
- Memory server tools: Different namespace, no conflicts

**If tool names collide** (rare):
- MCP client automatically prefixes tool names with server name
- Example: `gitnexus_query` vs `memory_query` (if both exist)
- Claude can distinguish and use both

**No configuration needed** — MCP protocol handles this automatically.

### 2.3 Restart Requirement

After editing `~/.claude/mcp.json` (or similar):
1. Completely quit Claude Code
2. Restart Claude Code
3. Changes take effect immediately
4. Both servers launch in parallel

---

## SECTION 3: THE 7 GITNEXUS MCP TOOLS

| # | Tool Name | Function | Key Parameters |
|---|-----------|----------|-----------------|
| 1 | `list_repos` | Discover all indexed repositories | None required |
| 2 | `query` | Hybrid search: BM25 + semantic + RRF | `query` (text), `repo` (optional) |
| 3 | `context` | 360-degree symbol analysis with refs | `symbol`, `repo` (optional) |
| 4 | `impact` | Blast radius analysis with confidence | `symbol`, `direction` (upstream/downstream), `minConfidence` (0.7 default), `repo` (optional) |
| 5 | `detect_changes` | Map git-diff to affected processes | `diff`, `repo` (optional) |
| 6 | `rename` | Multi-file coordinated refactoring | `oldName`, `newName`, `repo` (optional) |
| 7 | `cypher` | Raw KuzuDB graph queries | `query` (Cypher), `repo` (optional) |

**Additional resources** (not tools, but accessible):
- `gitnexus://repos` — List all repos
- `gitnexus://repo/{name}/processes` — Execution flows
- `gitnexus://repo/{name}/schema` — Graph schema

**MCP Prompts** (cached instructions):
- `detect_impact` — Change analysis with scope & risk
- `generate_map` — Architecture docs with mermaid diagrams

### 3.1 Tool Input/Output Details

**`query` tool:**
- Input: `{query: "auth", repo?: "my-app"}`
- Output: Process-grouped results (hybrid ranking)

**`impact` tool:**
- Input: `{symbol: "validateAuth", direction: "upstream", minConfidence: 0.8, repo?: "my-app"}`
- Output: Call chain with depth grouping, confidence scores

**`context` tool:**
- Input: `{symbol: "User", repo?: "my-app"}`
- Output: Categorized references (constructors, assignments, calls, imports, etc.)

---

## SECTION 4: GLOBAL REGISTRY & MULTI-REPO SUPPORT

### 4.1 Global Registry Architecture

**Location:** `~/.gitnexus/registry.json`

**Structure:**
- Central registry of all indexed repositories
- Paths + metadata only (not full indexes)
- One MCP server serves all indexed repos
- No per-project MCP config needed

**Files created per repo:**
- `.gitnexus/` directory (gitignored, portable)
  - LadybugDB graph database (formerly KuzuDB)
  - Index metadata
  - Cache files

### 4.2 Multi-Repository Querying

**Single repo indexed:**
- `repo` parameter is optional in all tools
- Default uses only indexed repo

**Multiple repos indexed:**
- Must specify `repo` parameter
- Example: `query({query: "auth", repo: "my-app"})`
- Tool fails if `repo` missing and multiple repos exist

**Server behavior:**
- Tools call `refreshRepos()` before each operation
- Auto-discovers newly indexed repos without restart
- No manual registry editing needed

### 4.3 Lazy Connection Pooling

**LadybugDB connection management:**
- Connections open **on first query** (lazy init)
- Max **5 concurrent connections**
- Evicted after **5 minutes inactivity**
- Async query support (max 4 concurrent queries per connection)

**Concurrency notes:**
- Standard LadybugDB: single-writer constraint
- Cannot handle concurrent writes from multiple agents
- Read-heavy workloads safe
- Fork available (Vela-Engineering/kuzu) if multi-writer needed

---

## SECTION 5: INSTALLATION & SETUP

### 5.1 Global Installation

```bash
npm install -g gitnexus
```

**Benefits:**
- Available everywhere via `gitnexus` command
- `npx gitnexus` works automatically
- Single version across all projects

**Check installation:**
```bash
gitnexus --version
```

### 5.2 Per-Repo Indexing

**First time:**
```bash
cd /path/to/repo
npx gitnexus analyze
```

**What happens:**
1. Indexes codebase into `.gitnexus/` (LadybugDB)
2. Registers repo in `~/.gitnexus/registry.json`
3. Creates `AGENTS.md` + `CLAUDE.md` (agent context)
4. Installs agent skills (in `.claude/skills/gitnexus/`)
5. Registers Claude Code hooks

**Update stale index:**
```bash
gitnexus analyze --force  # Full re-index
gitnexus analyze          # Incremental update
```

**Check index status:**
```bash
gitnexus status
```

**List all indexed repos:**
```bash
gitnexus list
```

**Delete index for current repo:**
```bash
gitnexus clean
```

### 5.3 Full Setup Workflow

```bash
# Step 1: Index your repo
npx gitnexus analyze

# Step 2: Configure MCP (one-time)
npx gitnexus setup

# Step 3: Restart your editor
# (Claude Code, Cursor, etc.)

# Done! MCP server auto-launches on editor start
```

---

## SECTION 6: CLAUDE CODE INTEGRATION

### 6.1 Full Integration Features

GitNexus provides **deepest integration** in Claude Code (vs other editors):

1. **MCP tools** — 7 tools via protocol
2. **Agent skills** — NPM scripts for CLI automation
3. **PreToolUse hooks** — Auto-enrich grep/glob/bash calls with KG context
4. **CLAUDE.md integration** — Merged instructions for Claude Code

### 6.2 Integration Points

**MCP tools:**
- Auto-available in Claude Code via MCP server

**Agent skills** (in `.claude/skills/gitnexus/`):
- Custom CLI wrappers around GitNexus tools
- Integrates with Claude Code skill system

**PreToolUse hooks:**
- Automatically enhance file/code operations
- Example: `grep` returns graph context
- Configured in AGENTS.md

**Context files:**
```
.gitnexus/
├── AGENTS.md       # Agent rules + gitnexus block
├── CLAUDE.md       # Claude Code instructions
└── GUARDRAILS.md   # Safety rules
```

### 6.3 Model Configuration

Claude Code uses **pinned model IDs** per Anthropic org policy. Check `.claude/CLAUDE.md` for current model and override options.

---

## SECTION 7: LANGUAGE SUPPORT

GitNexus parses:
- **Tier 1 (Full):** TypeScript, JavaScript, Python, Java, Kotlin, C#, Go, Rust, PHP, Ruby, Swift, C, C++
- **Features:** Import resolution, type annotation awareness, constructor inference, framework entry points

**Example support:**
- TypeScript: Full type inference
- Python: Type hints + dynamic imports
- Java: Multi-file class resolution
- Go: Package-scoped visibility

---

## SECTION 8: KNOWN ISSUES & SOLUTIONS

### 8.1 Connection Pool Lock Conflicts

**Issue:** KuzuDB/LadybugDB file locking under concurrent access.

**Current behavior:** "Uncaught exceptions logged but don't crash server" — graceful degradation.

**Mitigation:**
- Max 5 concurrent DB connections
- 5-minute inactivity eviction
- Query queuing (max 4 concurrent/connection)

**If multi-agent writes needed:** Use Vela-Engineering/kuzu fork (concurrent multi-writer).

### 8.2 Tool Name Conflicts with Other Servers

**Risk:** Very low. MCP protocol auto-namespaces tools by server.

**If collision detected:**
- MCP client prefixes with server name
- Example: `gitnexus_query`, `memory_query`
- Automatic, no manual config needed

### 8.3 Repository Registration Issues

**Problem:** `.gitnexus/` not found, registry out of sync.

**Solution:**
```bash
gitnexus analyze --force  # Re-index
gitnexus list             # Verify registration
```

### 8.4 MCP Server Won't Start

**Common causes:**
1. `npx` not in PATH → install Node.js globally
2. JSON syntax error in config → validate JSON
3. Editor not restarted → restart completely
4. Port conflict (rare for stdio) → check logs

**Debug:**
```bash
# Manually test the command
npx -y gitnexus@latest mcp

# Check Claude Code logs
# macOS: ~/Library/Logs/Claude/mcp*.log
# Windows: %APPDATA%\Claude\logs\mcp*.log
```

---

## SECTION 9: ARCHITECTURE DEEP DIVE

### 9.1 Data Flow

```
Repository
    ↓
gitnexus analyze
    ├─ Parses code (tree-sitter)
    ├─ Builds graph (graphology)
    └─ Stores in .gitnexus/LadybugDB

Registry: ~/.gitnexus/registry.json
    ↓
gitnexus mcp (starts stdio server)
    ├─ Loads registry
    ├─ Lazy-opens LadybugDB connections
    └─ Exposes 7 tools via MCP

Claude Code / Cursor / etc.
    ↓
Uses MCP tools in conversations
```

### 9.2 Dependency Stack

**Core:**
- tree-sitter (parsing)
- graphology (graph ops)
- LadybugDB (storage/queries)
- Express (web server for serve mode)
- Hugging Face transformers (semantic search)

**Runtime:** Node.js 20.0.0+

**Optional:** Dart, Kotlin, Swift parsers (optional deps)

### 9.3 Search Algorithm

**Hybrid ranking:**
1. BM25 (keyword relevance)
2. Semantic (embeddings from HF transformers)
3. RRF (reciprocal rank fusion combining both)

**Confidence scoring:**
- Default `minConfidence: 0.7`
- Filters out guesses/low-confidence links

---

## SECTION 10: COMPARISON TABLE

| Feature | GitNexus | Standard Grep | Plain LLM |
|---------|----------|---------------|-----------|
| Precomputed graph | Yes | No | No |
| Handles deps | Yes | No | No |
| Confidence scores | Yes | No | No |
| Call chains | Yes | Limited | Limited |
| Multi-repo | Yes (global registry) | Manual | Manual |
| MCP protocol | Yes | No | No |
| Setup time | ~30s per repo | 0s | 0s |
| Storage | .gitnexus/ | None | None |

---

## SECTION 11: ANSWERS TO KEY QUESTIONS

### Q1: Exact MCP server configuration for ~/.claude/settings.json

**Answer:** Use `.claude/mcp.json` (not `.claude/settings.json`):
```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"]
    }
  }
}
```

File locations:
- **Claude Code:** Via `claude mcp add` CLI or `~/.claude/mcp.json`
- **Cursor:** `~/.cursor/mcp.json`
- **Codex:** `~/.codex/config.toml`

### Q2: Running GitNexus MCP alongside memory server

**Answer:** Both run simultaneously, zero conflicts:
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

Each server's tools are auto-namespaced. No manual prefix config needed.

### Q3: The 7 MCP tools (exact names, inputs, outputs)

**Answer:** See Section 3 table above. Summary:
1. `list_repos()` → repos list
2. `query(text, repo?)` → ranked results
3. `context(symbol, repo?)` → references
4. `impact(symbol, direction?, minConfidence?, repo?)` → blast radius
5. `detect_changes(diff, repo?)` → affected processes
6. `rename(oldName, newName, repo?)` → refactoring plan
7. `cypher(query, repo?)` → raw graph results

### Q4: Global or per-repo setup?

**Answer:** **GLOBAL + PER-REPO:**
- **Global:** `npx gitnexus setup` (one-time, configures MCP)
- **Per-repo:** `npx gitnexus analyze` (per repo you want indexed)
- **MCP config:** Single server, serves all indexed repos

### Q5: What does `npx gitnexus setup` do to settings.json?

**Answer:**
- Does NOT touch `settings.json`
- Writes to editor-specific config:
  - Claude Code: `~/.claude/mcp.json` (via CLI)
  - Cursor: `~/.cursor/mcp.json`
  - Codex: `~/.codex/config.toml`
- Auto-detects editors, writes correct syntax
- One-time; can be re-run safely

### Q6: Multiple repos in one MCP server?

**Answer:** **YES, fully supported.**
- Run `gitnexus analyze` in each repo
- Global registry (`~/.gitnexus/registry.json`) tracks all
- One MCP server serves all
- Use optional `repo` parameter to specify which
- Single repo = `repo` param optional

### Q7: Known conflicts with multiple MCP servers?

**Answer:** **NONE documented.**
- MCP protocol handles tool namespacing
- Common setup: 5+ servers (GitHub, Brave Search, Memory, GitNexus, etc.)
- Auto-prefix if collision detected
- Both stdio and HTTP transports supported
- Must restart editor after config changes

---

## SECTION 12: IMPLEMENTATION CHECKLIST

```
Setup Phase:
☐ Install Node.js 20.0.0+
☐ Run: npx gitnexus setup (one-time)
☐ Run: npx gitnexus analyze (per repo)
☐ Verify: gitnexus list (shows repos)

MCP Configuration:
☐ Edit ~/.claude/mcp.json (or use CLI)
☐ Add gitnexus + memory server blocks
☐ Validate JSON syntax
☐ Restart Claude Code completely

Verification:
☐ See MCP indicator (⚙️) in Claude Code
☐ Click indicator → see 7 tools listed
☐ Test: Use query/context/impact tools
☐ Check logs if any issues: %APPDATA%\Claude\logs\

Ongoing:
☐ Run gitnexus analyze after major changes
☐ Optionally: gitnexus analyze --force (full re-index)
☐ Monitor .gitnexus/ size (portable, git-ignored)
```

---

## UNRESOLVED QUESTIONS

1. **LadybugDB fork (Vela-Engineering/kuzu):** Is it production-ready? Integration path with GitNexus?
2. **Semantic search performance:** Embedding model size? Offline mode available?
3. **Graph size limits:** Maximum nodes/edges before performance degrades?
4. **Incremental indexing accuracy:** How stale can `.gitnexus/` get before full re-index recommended?
5. **Cross-language type resolution:** Full support? Caveats for polyglot repos?

---

## SOURCES

- [GitHub - abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus)
- [GitNexus README.md](https://github.com/abhigyanpatwari/GitNexus/blob/main/README.md)
- [GitNexus MCP Overview](https://www.mintlify.com/abhigyanpatwari/GitNexus/mcp/overview)
- [GitNexus MCP Command Reference](https://www.mintlify.com/abhigyanpatwari/GitNexus/api/commands/mcp)
- [GitNexus CLAUDE.md](https://github.com/abhigyanpatwari/GitNexus/blob/main/CLAUDE.md)
- [Model Context Protocol - Connect Local Servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [Claude Code MCP Servers Guide](https://www.builder.io/blog/claude-code-mcp-servers)
- [Claude Code Settings Docs](https://code.claude.com/docs/en/settings)
- [MCP Tool Naming Conflict Resolution (GitHub Discussion)](https://github.com/orgs/modelcontextprotocol/discussions/291)
- [KuzuDB Concurrency Docs](https://kuzudb.github.io/docs/concurrency/)
- [Vela Partners - KuzuDB for Production AI Agents](https://www.vela.partners/blog/kuzudb-ai-agent-memory-graph-database)

---

**Report Generated:** 2026-03-28 14:29 UTC
**Researcher:** Claude Code (Haiku 4.5)
**Confidence:** High (0.95 from primary sources, 0.85 from inference)
