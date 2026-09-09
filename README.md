# Hermit Graph — v8 reconstruction

Local project memory for AI coding agents, with SQLite as knowledge authority and MCP over stdio. This checkout is a development build; v8 release gates are not yet signed off. The npm registry release is a separate artifact.

Requires Node.js 24+. Install checkout dependencies with `npm install`, then use `node scripts/brain-cli.mjs help`. In a packaged installation, use `hermit` instead.

## Setup

`hermit setup --agent codex --project /absolute/project/path` previews configuration changes. Add `--apply` to create backups, record owned edits and verify an isolated MCP connection. Malformed configuration or conflicting owned entries fail without overwriting unrelated settings. An existing unowned data root is refused, not silently adopted or migrated.

Configuration adapters: claude, cursor, gemini-cli, windsurf, cline, codex, opencode. `auto` selects detected clients; `all` is explicit. Cline targets its VS Code extension. Claude and Codex have tested stable session hooks. Other adapters currently provide MCP configuration with degraded session lifecycle. Actual client/OS validation remains a release gate.

`hermit uninstall --agent codex` previews removal; add `--apply` to remove owned integrations while retaining knowledge and unrelated settings.

## Knowledge

SQLite stores stable project/entity IDs, observations, relations, lifecycle and history. Active knowledge is the default; inference remains candidate until explicitly accepted. Known IDs never bypass project scope. Global recall requires explicit inclusion.

```sh
hermit search "architecture" --json
hermit review list
hermit review accept ENTITY_ID
hermit archive ENTITY_ID
hermit restore ENTITY_ID
hermit stale
```

Default search is lexical and never loads/downloads a model. `hermit model status` is read-only. `hermit model install` explicitly installs the pinned model into staging, validates artifacts/checksums, then publishes the cache. `hermit model backfill` generates derived vectors. Missing/invalid artifacts degrade optional vector search to lexical. Transformers is optional and must be installed for model operations.

## Scan and code impact

```sh
hermit scan collect
hermit scan preview RUN_ID
hermit scan commit RUN_ID
hermit index
hermit check-edit src/example.js --format=json
```

Collection stores a preview without writing knowledge. Commit rechecks source hashes and refuses conflicts with reviewed observations. Code tools refresh against uncommitted/untracked changes and deletions. Failed builds preserve the last verified graph and report failure. Static analysis marks dynamic dispatch unknown.

## Diagnostics and maintenance

```sh
hermit doctor
hermit doctor errors
hermit doctor show CORRELATION_OR_FINGERPRINT_ID
hermit doctor mark FINGERPRINT_ID --state investigating
hermit doctor bundle --preview
hermit doctor prune --dry-run
hermit status
hermit backup create /absolute/fresh-backup-directory
hermit upgrade plan
hermit reset knowledge
```

Diagnostics retain bounded operational metadata, not raw tool inputs/results, exception messages, stacks or transcripts. Startup/CLI failures use bounded capsules; successful server boot imports them once. `HERMIT_DIAGNOSTICS=off` disables normal recording. Incident promotion requires explicit complete evidence after verified resolution.

Restore, upgrade and reset use exclusive maintenance and verified backups. Mutations require exact preview confirmation via `--apply --confirm-file FILE`; inspect command help and preview output first. Close all runtimes, including older releases without leases. Recovery does not treat age alone as proof of a dead owner. No automatic v7 JSONL importer is shipped.

## Viewer and export

`hermit view` opens a read-only loopback viewer with bundled assets; `hermit view --snapshot` writes offline HTML. `hermit export --out knowledge.json` creates a fresh versioned knowledge export; `--all` explicitly includes every project. The viewer accepts this format. SQLite backup/restore is the full database round trip; JSON export is not a database restore command.

## Data and validation

`HERMIT_DATA_DIR` selects an absolute root. Defaults: LocalAppData/HermitGraph on Windows, Library/Application Support/HermitGraph on macOS, XDG data home/hermit-graph on Linux. `HERMIT_DB_PATH` explicitly overrides the absolute database path.

Run `npm test` for functional, E2E, documentation and package checks. Historical machine-dependent thresholds run separately with `npm run bench:legacy`; `npm run bench:v8` measures the v8 diagnostics budget. Functional test success does not imply a performance benchmark passed. See [the reconstruction ledger](plans/260907-1601-hermit-v8-product-truth/reconstruction-ledger.md) for reproduced evidence and outstanding gates. Historical documents are not proof of v8 completion.
