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

## Diagnostic identity and correlation — 2026-09-09

This slice supersedes the minimal fingerprint/session implementation limitation above. Schema 8 revision 3 adds normalized cause signatures, bounded package-relative frames, operation names, diagnostic session references and imported capsule references. A per-vault HMAC key stays out of diagnostic bundles; plaintext error messages are not stored. Explicit revision 2-to-3 upgrade preserves knowledge and aggregate totals; normal runtime refuses the older revision without rewriting it.

MCP memory, scan and code operations propagate child context and record one failure after the primary transaction unwinds. Failure envelopes expose a queryable diagnostic reference; capsule fallback preserves correlation through import. Lookup and sample retrieval both resolve correlation IDs. Successful child spans are context-only, not persistent trace rows.

Scope still open: full CLI/hook success-span correlation, complete boot-stage capture and per-table age/byte acceptance coverage. Existing CLI/hook failures have safe capsule correlation. This is not a claim that every planned diagnostics acceptance case is complete. Cross-platform/client validation and independent release review remain pending as listed above.

Fresh revision 3 verification:
- Canonical npm test passed: 237 legacy checks, 125 Node test results, 18 E2E, 30-file authority check, documentation/entrypoint check, 222-file package scan and all 22 MCP tools plus resource. Evidence: outputs/v8-revision3-canonical.log in the review workspace.
- That run includes 16 processes x 1000 failures with exactly 16000 retained and hard-kill recovery at seven writes plus the COMMIT boundaries.
- Recorder-only microbenchmark passed at 500 samples: success p95 1.364 ms, failure p95 1.844 ms. This measures recorder writes, not complete MCP request latency or child-span overhead. Evidence: outputs/v8-revision3-benchmark.json.
- Repacked current source and installed it into the isolated npm consumer fixture; all 22 tools and the resource passed again. No repository node_modules junction is used for this consumer check. Dependencies from the earlier clean installation were reused; this was a tarball update, not another clean dependency installation.

## Windows release candidate scope — 2026-09-09

User approved Windows-first qualification and npm `8.0.0-rc.0` on tag `next`; macOS/Linux is deferred. This overrides the earlier all-platform release blocker for this candidate only. Interactive testing in every client, competitor benchmarks and independent review remain follow-up work, not claims made by the RC.

CLI dispatch now passes safe UUIDv7 trace/parent context to its child process, binds existing project scope without initializing storage and reports import/unhandled/exit failures. Hook bridges preserve child references and look up existing stable sessions; recall/capture adapters propagate available upstream IDs and disclose failures without blocking the client. Successful operations carry transient context, not persistent success trace rows. Read-only doctor failures explicitly disclose unavailable durable diagnostics without creating a missing vault.

Capsule identity now equals the operation correlation ID when available, including expected aggregate-only failures. Imports can recover a known runtime session link. Unknown raw upstream IDs, arguments and transcripts are not retained. Already-correlated setup failures are not captured twice.

Acceptance tests cover import/open/initialize/ready boot faults, background uncaught failure, incompatible-schema byte preservation, diagnostics-off and full-spool fallback; all diagnostic table insertion budgets, age pruning, protected incident histories, import tombstones, exact lifetime totals, bounded capsule bytes/count and sanitized quarantine. Limits bound diagnostic rows/payloads, not the entire shared knowledge database file or externally pinned WAL readers.

Initial canonical Windows run passed 137 Node results, 237 legacy checks, 18 E2E, 30 authority files and a 223-file package smoke invoking 22 tools plus resource. Subsequent boot/correlation/setup checks passed 34 results after the background-failure and correlated-setup fixes. Final RC preflight and registry publication are recorded separately when completed.

Final RC evidence at source commit `4ce5355`:
- `publish-preflight.mjs` exited 0: all 6 required checks passed; the absent optional README What's New section is explicitly skipped.
- Canonical suite: 138 Node results, 237 legacy checks, 18 E2E, 30 authority files; 223 packaged files and all 22 MCP tools plus resource passed. Evidence: review-workspace outputs/v8-rc0-preflight.log.
- The exact RC tarball was installed into the isolated npm consumer fixture and its 22-tool/resource smoke passed; packaged CLI reports 8.0.0-rc.0.
- Recorder-only benchmark: 500 samples, success p95 1.126 ms and error p95 2.017 ms; this is not a whole-request latency or competitor comparison.
- Tarball SHA-1: `19d06967bb33625a79cf183d4b4f356929e268ea` (full integrity in outputs/v8-rc0-pack.json).
- First npm publish attempt was rejected with 403 because the account has 2FA disabled. Registry still returns 404 for 8.0.0-rc.0 and latest remains 7.1.0. Publication is pending account authentication, not local acceptance work.
