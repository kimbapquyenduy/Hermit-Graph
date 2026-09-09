# System architecture — v8 development

The public launcher opens schema 8 revision 3 through BrainStore. Incompatible databases fail before runtime DDL; upgrade is explicit maintenance. SQLite is authoritative for identity, knowledge, lifecycle, history, sessions and diagnostics. Retained JSONL helpers serve historical tests, not the v8 knowledge path.

MemoryService enforces project scope for names and IDs. MCP, CLI and hook bridges use scoped operations. Inference enters candidate lifecycle. Active observations feed FTS; stable entity IDs key derived model vectors. Global reads require explicit inclusion.

ScanService separates collection, preview and hash-checked commit. CodeIndexService hashes source, builds in staging and publishes only a complete unchanged-source graph. Cache lives under the data root. Static impact joins scoped business references and marks dynamic dispatch unknown.

Diagnostics wrap the MCP protocol handler once, including SDK validation and returned errors. Safe metadata, normalized-cause HMAC signatures and bounded package-relative frames enter a bounded SQLite ledger. The HMAC salt stays in the database and is excluded from diagnostic bundles. Child operations retain parent/trace/session linkage; the outer handler records a failure once after transaction rollback. CLI/startup failures use bounded capsules, imported idempotently at boot. Incident promotion requires verified internal faults, complete human evidence and matching project/domain identity.

Setup patches JSONC/TOML/marked content with ownership manifests and rollback. Maintenance leases exclude cooperative runtimes during restore, upgrade and reset. Recovery requires a proven dead local owner. Older binaries without leases must be closed by the operator. Backups carry hashes/schema metadata; replacement validates integrity and foreign keys.

The loopback viewer is read-only with bundled assets. Knowledge export is versioned JSON; full recovery uses SQLite backup. See the reconstruction ledger for tested and unverified gates.
