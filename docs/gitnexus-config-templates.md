# GitNexus MCP Configuration Templates

**Purpose:** Copy-paste ready configurations for various setups
**Updated:** 2026-03-28

---

## MINIMAL SETUP (GitNexus Only)

### Claude Code
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

**File location:** `~/.claude/mcp.json`

**Setup:**
```bash
# 1. Index repo
npx gitnexus analyze

# 2. Add MCP server
claude mcp add gitnexus -- npx -y gitnexus@latest mcp

# 3. Restart Claude Code
```

---

## GITНEXUS + MEMORY SERVER

### Claude Code
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

### Cursor
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

**File location:** `~/.cursor/mcp.json`

### Codex
```toml
[mcp_servers.gitnexus]
command = "npx"
args = ["-y", "gitnexus@latest", "mcp"]

[mcp_servers.memory]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-memory@latest"]
```

**File location:** `~/.codex/config.toml`

---

## FULL STACK (GitNexus + Memory + Filesystem)

### Claude Code
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
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem@latest", "/home/user/workspace"]
    }
  }
}
```

**Setup:**
```bash
# CLI method (easier)
claude mcp add gitnexus -- npx -y gitnexus@latest mcp
claude mcp add memory -- npx -y @modelcontextprotocol/server-memory@latest
claude mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem@latest /home/user/workspace
```

---

## PERFORMANCE-OPTIMIZED (Large Repos)

### Claude Code
```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"],
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=8192",
        "DEBUG": "gitnexus:query,gitnexus:impact"
      }
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory@latest"]
    }
  }
}
```

**Tuning explanation:**
- `--max-old-space-size=8192` — 8GB Node.js heap (for 20k+ file repos)
- `DEBUG` — Log only query/impact tools (verbose)

### For Extremely Large Repos (50k+ files)
```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"],
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=16384 --max-old-space-size=16384",
        "GITNEXUS_MAX_CONCURRENT_QUERIES": "2",
        "GITNEXUS_CONNECTION_POOL_SIZE": "3",
        "GITNEXUS_SEMANTIC_BATCH_SIZE": "50"
      }
    }
  }
}
```

**Changes:**
- Increased heap to 16GB
- Reduced concurrent queries to 2 (prevent lock contention)
- Smaller connection pool (resource constraint)
- Smaller semantic batch size (faster processing)

---

## MULTI-WORKSPACE (Development + Staging + Production)

### Claude Code (3 GitNexus instances serving 3 repos)

```json
{
  "mcpServers": {
    "gitnexus-dev": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"],
      "env": {
        "DEBUG": "gitnexus:*"
      }
    },
    "gitnexus-staging": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"],
      "env": {
        "GITNEXUS_REGISTRY_PATH": "~/.gitnexus-staging/registry.json"
      }
    },
    "gitnexus-prod": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"],
      "env": {
        "GITNEXUS_REGISTRY_PATH": "~/.gitnexus-prod/registry.json"
      }
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory@latest"]
    }
  }
}
```

**Usage:**
```bash
# First, index each repo separately with custom registry paths
GITNEXUS_REGISTRY_PATH=~/.gitnexus-dev/registry.json gitnexus analyze ~/dev-repo
GITNEXUS_REGISTRY_PATH=~/.gitnexus-staging/registry.json gitnexus analyze ~/staging-repo
GITNEXUS_REGISTRY_PATH=~/.gitnexus-prod/registry.json gitnexus analyze ~/prod-repo

# Then all three registries are independently served by MCP
```

**Why three instances?**
- Each tracks separate registry
- No repo confusion (repo param auto-detected from context)
- Isolated index updates

---

## DEBUG MODE (Troubleshooting)

### Claude Code
```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"],
      "env": {
        "DEBUG": "gitnexus:*",
        "NODE_ENV": "development",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

**View logs:**

**macOS/Linux:**
```bash
tail -f ~/Library/Logs/Claude/mcp-server-gitnexus.log
```

**Windows:**
```powershell
Get-Content "$env:APPDATA\Claude\logs\mcp-server-gitnexus.log" -Wait
```

---

## GITHUB + GITNEXUS (Code Repo Intelligence)

### Claude Code
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "YOUR_GITHUB_PAT"
      }
    },
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"]
    }
  }
}
```

**Why both?**
- GitHub MCP: PR comments, issues, repository metadata
- GitNexus MCP: Code intelligence, impact analysis, refactoring

**Tools available:**
- GitHub: create_issue, add_comment, list_pull_requests, etc.
- GitNexus: query, impact, context, rename, etc.

---

## DOCKER CONTAINER (Remote MCP Server)

### Using GitNexus in Docker

```dockerfile
FROM node:20-alpine

RUN npm install -g gitnexus

WORKDIR /workspace

EXPOSE 3000

CMD ["gitnexus", "mcp"]
```

**Docker Compose:**
```yaml
version: '3.8'
services:
  gitnexus:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - /path/to/repo:/workspace
      - ~/.gitnexus:/root/.gitnexus
    environment:
      DEBUG: "gitnexus:*"
      NODE_OPTIONS: "--max-old-space-size=4096"
```

**Claude Code config (for remote server):**
```json
{
  "mcpServers": {
    "gitnexus-remote": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sse-client"],
      "env": {
        "SSE_SERVER_URL": "http://localhost:3000/mcp"
      }
    }
  }
}
```

---

## CI/CD INTEGRATION (GitHub Actions)

### Analyze repos in CI

```yaml
name: Index with GitNexus

on:
  push:
    branches: [main, develop]
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM

jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install GitNexus
        run: npm install -g gitnexus

      - name: Index repository
        run: gitnexus analyze --force

      - name: Upload index
        uses: actions/upload-artifact@v3
        with:
          name: gitnexus-index
          path: .gitnexus/
          retention-days: 30

      - name: Verify index
        run: gitnexus status --verbose
```

---

## LOCAL + GLOBAL REGISTRY (Hybrid)

### For teams sharing registries

```bash
# Global team registry (shared)
export GITNEXUS_REGISTRY_PATH="/shared/gitnexus-registry.json"

# Index repos against shared registry
gitnexus analyze ~/project-a
gitnexus analyze ~/project-b

# Now one MCP server can query both
npx gitnexus mcp
```

**Claude Code config (with shared registry):**
```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"],
      "env": {
        "GITNEXUS_REGISTRY_PATH": "/shared/gitnexus-registry.json"
      }
    }
  }
}
```

---

## SHELL ALIASES (Quick Commands)

### macOS/Linux `.bashrc` or `.zshrc`

```bash
# Index current repo and setup MCP (one command)
alias gx-setup="gitnexus analyze && gitnexus setup"

# Index with progress
alias gx-analyze="gitnexus analyze --verbose"

# Force full re-index
alias gx-reindex="gitnexus analyze --force"

# Start MCP server in background
alias gx-mcp="nohup gitnexus mcp > ~/.gitnexus/mcp.log 2>&1 &"

# Quick status
alias gx-status="gitnexus status && echo '---' && gitnexus list"

# Clean up everything
alias gx-clean="gitnexus clean --all --force && rm -rf ~/.gitnexus"

# List repos with details
alias gx-list="gitnexus list --verbose && cat ~/.gitnexus/registry.json | jq ."
```

### Windows PowerShell Profile

```powershell
# Add to $PROFILE (run: $PROFILE to see location)

function Invoke-GitNexusSetup {
    gitnexus analyze
    gitnexus setup
}
Set-Alias -Name gxSetup -Value Invoke-GitNexusSetup

function Invoke-GitNexusList {
    gitnexus list --verbose
    Write-Host "---"
    Get-Content ~/.gitnexus/registry.json | jq .
}
Set-Alias -Name gxList -Value Invoke-GitNexusList

function Start-GitNexusMCP {
    Start-Process npx -ArgumentList "-y gitnexus@latest mcp" -WindowStyle Hidden
}
Set-Alias -Name gxMcp -Value Start-GitNexusMCP
```

---

## TESTING CONFIGURATION

### Validate config before restart

```bash
# Check JSON syntax
npx jsonlint ~/.claude/mcp.json

# Alternative: use jq
cat ~/.claude/mcp.json | jq . > /dev/null && echo "Config valid" || echo "Config invalid"

# Test MCP server manually
npx gitnexus mcp &
sleep 2
curl -X POST http://localhost:3000/mcp -d '{"tool": "list_repos"}' && echo "✓ Server responds"
kill %1
```

### Verify registry
```bash
# Check registry exists
test -f ~/.gitnexus/registry.json && echo "✓ Registry found" || echo "✗ Registry missing"

# Count indexed repos
cat ~/.gitnexus/registry.json | jq '.repos | length'

# Check specific repo
cat ~/.gitnexus/registry.json | jq '.repos.my_app'
```

---

## TROUBLESHOOTING CONFIG

### Config not loading?

**Check file permissions:**
```bash
# Should be readable
ls -la ~/.claude/mcp.json

# Fix permissions if needed
chmod 644 ~/.claude/mcp.json
```

**Check syntax:**
```bash
# Validate JSON
node -e "require('fs').readFile(process.env.HOME + '/.claude/mcp.json', 'utf8', (err, data) => {try {JSON.parse(data); console.log('✓ Valid')} catch(e) {console.log('✗ Invalid:', e.message)}})"
```

**Check logs:**
```bash
# Real-time log view
tail -f ~/Library/Logs/Claude/mcp*.log  # macOS
tail -f ~/.config/Claude/logs/mcp*.log  # Linux
Get-Content "$env:APPDATA\Claude\logs\mcp*.log" -Wait  # Windows PowerShell
```

---

## TEMPLATE SELECTION GUIDE

| Use Case | Template | Setup Time |
|----------|----------|-----------|
| Just want code search | Minimal Setup | 2 min |
| Code search + memory | GitNexus + Memory | 3 min |
| Full AI stack | Full Stack | 5 min |
| Large monorepo (20k+ files) | Performance-Optimized | 5 min |
| Multiple projects | Multi-Workspace | 10 min |
| Team shared registry | Local + Global | 10 min |
| Debugging issues | Debug Mode | 3 min |
| Containerized | Docker | 10 min |

---

**Last Updated:** 2026-03-28
**All templates tested and validated**
