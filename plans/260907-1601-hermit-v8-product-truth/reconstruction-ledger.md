# Hermit v8 reconstruction ledger — 2026-09-08

This ledger supersedes historical test claims for the deleted C: worktree. Only results reproduced against the D: checkout count. Baseline checkpoint: 510517d.

Implemented reconstruction slices:
- SQLite schema 8, scoped entity IDs, active FTS, lifecycle/history, nested synchronous transactions, read-only checks and consistent backup.
- MemoryService scoped access and explicit global recall; MCP stdio round-trip restart test. Default launcher uses v8; HERMIT_STORAGE=legacy selects the checkpoint implementation.
- CLI lexical search, health, doctor, backup, stable-ID viewer snapshots; explicit model install/status/backfill and offline local runtime.
- Model vectors use entity ID + model/hash; invalid or absent cache falls back without downloading.

Fresh verification: npm test passed 237 legacy checks and 23 tests at that run. Subsequent test:v8 passed 23 tests after additional regressions; code-intel E2E reports 18 pass (its historical live-MCP scenario skips; v8 has a separate real stdio test).

NOT a phase 3 or release sign-off. Remaining work includes complete hook/scanner/service cutover, single-authority verifier, stable moved/worktree identity matrix, safe setup/upgrade/uninstall, complete diagnostic correlation/capsule/retention, concurrency/crash matrix and release benchmarks. Existing legacy scripts remain explicitly isolated or require further cutover; their existence must not be presented as complete single-authority compliance.

No user knowledge migration or model download has run. Current implementation is a reconstruction checkpoint, not recovered original source.

Final checkpoint verification: npm test = 237 legacy checks + 33 Node tests passed; git diff --check clean. Separate E2E reports 18 pass, with historical live-MCP skip explicitly noted above. The real v8 stdio test covers boot/restart/scope. Added UUID/worktree/move identity foundation and sessionRootPath to avoid executing code against stale registration paths. Added import-blocking regression proving v8 boot/code query cannot resolve legacy embeddings or Transformers.

Commit attempt blocked: .git/index.lock permission denied even after scoped permission grant. No v8 commit was created. A source snapshot is saved under the review workspace outputs; original baseline commit remains 510517d.

## Hook/scanner cutover completed — 2026-09-08

Supersedes hook/scanner pending status above. Shared recall, extraction and pre-edit hooks use a normalized SQLite bridge. All five auto-update adapters honor payload cwd; copied hooks resolve a pinned package runtime manifest. Captures are scoped candidates, atomic/idempotent, and never append inference to reviewed entities. Scanner reads scoped active ScanMeta and writes candidates through MemoryService; MCP deep scan is registered and candidate writes are supported. Related setup generation uses HERMIT_DATA_DIR instead of legacy knowledge-file configuration.

Fresh checks: npm test = 237 suite checks + 41 Node tests, all pass; verify:hooks checks 29 scoped source files; E2E reports 18 pass (historical live-MCP skip remains separately covered by real v8 stdio test). Session index.jsonl is operational metadata; derived code indexes are caches. Neither stores authoritative knowledge. This targeted verifier does not claim full repository single-authority/release compliance.

A fixture initially resolved a project inside the repository and created a test UUID marker in .git. It was identified by UUID/time, removed with exact-content guard, and fixtures now use OS temporary projects. No knowledge migration was performed.

Remaining v8 gates: complete diagnostics/crash handling, safe setup/upgrade/uninstall validation, broader concurrency/recovery/privacy matrix and release benchmarks. Previous commit-permission limitation is retried separately.

Commit restriction resolved through approved Git escalation: reconstruction and hook/scanner cutover saved in c0c926d. No push or release performed.
