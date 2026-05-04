-- sqlite-schema.sql — Brain DB schema v1
-- All CREATE TABLE uses IF NOT EXISTS for idempotent boot.
-- Schema version tracked in meta table for future migrations.

-- Core entity registry
CREATE TABLE IF NOT EXISTS entities (
  name        TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-entity observations with parsed confidence/date columns
-- ord preserves insertion order; UNIQUE(entity_name, ord) prevents dups on re-insert
CREATE TABLE IF NOT EXISTS observations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_name TEXT NOT NULL REFERENCES entities(name) ON DELETE CASCADE,
  raw_text    TEXT NOT NULL,
  confidence  REAL NOT NULL DEFAULT 0.8,
  obs_date    TEXT,
  category    TEXT,
  ord         INTEGER NOT NULL DEFAULT 0,
  UNIQUE(entity_name, ord)
);

-- Relations between entities
CREATE TABLE IF NOT EXISTS relations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_name     TEXT NOT NULL,
  to_name       TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  UNIQUE(from_name, to_name, relation_type)
);

-- FTS5 virtual table — contentless, populated via triggers or explicit inserts
-- indexes entity names + observation text for BM25 search (phase 01c)
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  name,
  obs_text,
  content=''
);

-- Schema metadata: version flags, future migration markers
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes for hot-path lookups
CREATE INDEX IF NOT EXISTS idx_observations_entity_name ON observations(entity_name);
CREATE INDEX IF NOT EXISTS idx_relations_from_name ON relations(from_name);
CREATE INDEX IF NOT EXISTS idx_relations_to_name ON relations(to_name);
