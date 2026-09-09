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

## Runtime and maintenance reconstruction checkpoint — 2026-09-09

Version is now 8.0.0-dev.0, unreleased. This supersedes earlier CLI/legacy-mode and session-JSONL statements in this ledger. Public commands and hooks use SQLite. Legacy executable bins are removed from the package; historical implementation modules remain in the source for regression tests.

Implemented and exercised locally:
- Owned JSONC/TOML/marked configuration setup/uninstall, backups, isolated MCP smoke, rollback and explicit unowned-root refusal; seven configuration adapters, stable Claude/Codex session hooks, explicit degraded lifecycle elsewhere.
- Runtime leases and explicit schema upgrade; verified backup/restore/reset, stale-owner evidence, swap journal recovery and rollback. Diagnostics reset reseeds its schema marker. Knowledge reset also clears pending scan runs.
- Deterministic collect/preview/commit scans, conflicts for reviewed observations, current-source index publication with parser/package signature, and centralized code cache.
- Metadata-only diagnostic ledger, UUIDv7 request/operation IDs, bounded samples, safe capsules, triage/promotion commands, startup/CLI/hook capture, protected transition samples and pruning. SDK validation/unknown-tool failures are aggregated as expected input errors.
- Versioned knowledge export, full SQLite restore preserving exported identities/lifecycles/history/empty projects, bundled read-only loopback viewer with Host/Origin/method checks.
- Pinned model revision 751bff37182d3f1213fa05d7196b954e230abad9, staged validation before publication, no replacement of a valid cache, and vector keys that include model revision. Model weights were not downloaded during this work.
- Canonical manifest-driven runner, real MCP E2E, package contents/canary scan, extracted-tarball smoke, documented CLI checks and a Node 24 Windows/macOS/Linux CI definition.

Fresh evidence:
- Canonical npm test: 237 legacy checks, 118 Node test results, 18 E2E scenarios, 30-file hook/scanner authority check, documented command check, and 22-tool/resource extracted package smoke passed (v8-canonical-release-check.log).
- An actual clean npm consumer installation also booted the tarball and invoked all 22 advertised MCP tools plus the resource. Later changes are covered by extracted-package and targeted tests; final release needs a fresh immutable artifact rerun.
- Subsequent diagnostics/code/offline validation: 15/15, including 16 processes x 1000 = exactly 16000 aggregate failures and hard kills during individual writes and around COMMIT.
- Subsequent model/maintenance validation: 20/20. Two added regressions first failed and then passed: diagnostics reset schema-marker loss and stale unpinned model vectors.
- Default tool smoke with socket/DNS/fetch calls blocked passed without any network attempt.
- Diagnostics benchmark, 500 samples on Windows x64 / Node v24.20.0 / i5-1335U: success p95 1.276 ms, error p95 2.044 ms, under 2/5 ms thresholds. Raw samples are in the review workspace outputs/v8-runtime-benchmark-final.json.

Performance qualification: historical timing assertions were unstable under concurrent load. They remain enforced by npm run bench:legacy; npm test runs their functional checks and reports timings as informational. Functional success is not a legacy performance sign-off. Historical retrieval-corpus evaluation and the generic business-rule template are explicitly classified in test/test-manifest.json, not silently counted as executed tests. Tests no longer rewrite checked-in baseline files.

Still not a Phase 9/release sign-off:
- The diagnostic fingerprint currently groups safe code/component/phase/category/project metadata. Full normalized cause/operation/frame grouping and complete session/child-span linkage require another implementation/acceptance pass; do not equate this stricter minimal metadata design with the full plan contract.
- The full boot-stage and per-table age/byte acceptance matrix still needs final review beyond the concrete crash/bounds tests above.
- macOS/Linux CI has been defined but not run here; real client lifecycle behavior for the full adapter matrix is not verified. Non-Claude/Codex hook support is not claimed.
- Competitor evaluations are NOT_TESTED; no universal performance or superiority claim is made.
- No independent final reviewer sign-off: delegated reviewers hit their account usage limit. Parent verification is not represented as an independent review.
- No push, publish, real user-vault migration/reset or model-weight download was performed.
