# BUSINESS.md — Hermit Graph impact map

Hermit stores persistent project knowledge for AI coding agents. v8 targets one SQLite brain.db as knowledge authority; code indexes and model vectors are rebuildable derived data.

## Core entities

Projects carry stable scope IDs. Knowledge entities have stable IDs, names, one of 13 taxonomy types and lifecycle. Observations belong to entity IDs; relations connect IDs. Change events preserve audit history. Diagnostics contain safe operational metadata.

## Impact chains and invariants

- Storage → MemoryService → MCP/CLI/viewer/model. Scope must be enforced even when callers supply a known entity ID. Global recall requires explicit inclusion. Resource reads cannot change session context.
- Observation/lifecycle writes → FTS and vector invalidation → retrieval. Active is the default; archived data remains auditable and explicitly readable. Candidate inference is not active knowledge.
- Path/project resolution → every adapter. Server working directory is not project evidence. Existing incompatible databases must be rejected without migration or mutation.
- Model installation → validated local artifacts → optional embedding runtime. Only explicit installation downloads. Missing/invalid cache degrades to lexical search.
- Backup → fresh destination → integrity validation. No overwrite or live data migration during reconstruction.

## Required checks

Run v8 scope/collision/lifecycle/rollback/restart/offline/CLI/backup tests, legacy compatibility suite and code-intel E2E. Full phase gates additionally require hook/scanner parity, identity move/worktree conflicts, concurrent writers/crash recovery, safe setup and diagnostics privacy matrix. See plans/260907-1601-hermit-v8-product-truth/reconstruction-ledger.md for current coverage; this map does not assert unfinished gates pass.
