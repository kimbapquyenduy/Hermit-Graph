# Learn Project — Phát Hiện Convention

Scan current project to auto-detect conventions and save to memory.

## Input
$ARGUMENTS — project path or name (optional; defaults to cwd)

## Quy trình

### 1. Detect project type
- Check package.json, requirements.txt, Cargo.toml, go.mod, pom.xml
- Identify: Node.js, Python, Rust, Go, Java, etc.

### 2. Scan conventions
- **Naming**: camelCase vs snake_case (scan 20+ source files)
- **Imports**: ESM (`import`) vs CJS (`require`)
- **File structure**: src/, lib/, utils/, components/ patterns
- **Build tools**: npm scripts, Makefile targets, CI configs
- **Linting**: ESLint, Prettier, Biome config files
- **Runtime**: .nvmrc, .python-version, .tool-versions

### 3. Calculate confidence
- >80% occurrence = high confidence (0.9)
- 60-80% = medium confidence (0.7)
- <60% = low confidence (0.5), flag as uncertain

### 4. Display results
| Convention | Detection | Confidence | Status |
|-----------|-----------|------------|--------|
| ESM imports | 95% of files use import | 0.9 | Confirmed |
| camelCase naming | 78% prevalence | 0.7 | Confirmed |
| Prettier formatting | .prettierrc found | 0.95 | Confirmed |

### 5. Save to KG
- Create `PATTERN:ARCH:ProjectName:ConventionName` entities with entityType `pattern-arch`
- Use `[confidence|date]` prefix: `[0.7|2026-03-26] WHAT: camelCase naming convention`
- Create relation: `BIZ:ProjectName` → `uses_pattern` → `PATTERN:ARCH:ProjectName:Convention`

### 6. Ask user to confirm
- "These conventions look correct? [Y/n]"
- If confirmed → bump confidence to 0.9
- If rejected → delete entity
