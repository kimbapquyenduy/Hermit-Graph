# Codebase summary — v8 development

| Area | Implementation |
|---|---|
| CLI / MCP | scripts/brain-cli.mjs, hermit-mcp-server.mjs, hermit-mcp-v8.mjs |
| Knowledge | scripts/lib/storage/, scripts/lib/memory-service.mjs |
| Hooks | catalog/hooks/lib/sqlite-bridge.cjs, scripts/hermit-hook.mjs |
| Sessions | scripts/lib/runtime/session-service.mjs |
| Setup | scripts/lib/setup/ |
| Backup / upgrade / reset | scripts/lib/maintenance/ |
| Diagnostics | scripts/lib/diagnostics/ |
| Scan | scripts/lib/scan/scan-service.mjs |
| Code freshness | scripts/lib/code-intel/code-index-service.mjs |
| Model | scripts/lib/v8-model.mjs |
| Viewer / export | scripts/view-graph.mjs, scripts/lib/export-v8.mjs |

Phase tests are under test/v8-*.test.mjs. Legacy source/tests remain for historical regression coverage; they are not supported v8 commands. The reconstruction ledger records actual results.
