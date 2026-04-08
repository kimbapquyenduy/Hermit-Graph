# DB Migrations — Safe Database Migration Practices

## Purpose
Guide creation and execution of database migrations with pre-flight checks, gotcha warnings, and automatic persistence of discovered issues to memory.

## When to Activate
- User is writing or running a database migration
- User is changing a schema (add column, drop table, rename, alter type)
- User is running `prisma migrate`, `knex migrate`, `flyway`, `liquibase`, or raw DDL

---

## Workflow

### Step 1: Search Past Migration Issues
```json
search_nodes("migration")
search_nodes("GOTCHA:")
```
Surface any previously saved gotchas before proceeding.

### Step 2: Pre-Migration Checklist

Run this before any migration reaches a shared environment:

- [ ] **Backup** — is a backup strategy confirmed for production?
- [ ] **Rollback plan** — does a `down` migration or manual revert script exist?
- [ ] **Data migration** — if rows are being transformed, has the script been tested on a data sample?
- [ ] **Downtime estimate** — is the team aware if the operation locks tables?
- [ ] **Zero-downtime compatibility** — is the schema change backward-compatible with the running app version?

### Step 3: Gotcha Warnings by Category

Warn the user proactively when any of these apply:

**NULL Constraints**
- Adding `NOT NULL` without a `DEFAULT` fails on non-empty tables
- Fix: add column as nullable → backfill → add constraint

**Column Drops**
- Dropping a column with dependent views or computed columns causes silent errors
- Fix: audit `information_schema.view_column_usage` first

**Enum Changes (Prisma / TypeORM)**
- Prisma does not auto-migrate enum additions on PostgreSQL
- Fix: use raw SQL `ALTER TYPE ... ADD VALUE` in a custom migration

**Large Table ALTER**
- `ALTER TABLE` on millions of rows locks the table in most engines
- Fix: use `pt-online-schema-change` (MySQL) or `pg_repack` / concurrent index build (PostgreSQL)

**Foreign Key Order**
- Dropping a referenced table before its dependents causes constraint violations
- Fix: always drop or nullify dependents first

### Step 4: Save Migration Gotcha to Memory

When a migration issue is discovered or resolved:

```json
create_entities([{
  "name": "GOTCHA:PrismaEnumMigration",
  "entityType": "incident-gotcha",
  "observations": [
    "WHAT: Prisma does not generate an ALTER TYPE migration for new enum values on PostgreSQL",
    "IMPACT: Deploy fails silently or throws 'invalid input value for enum' at runtime",
    "FIX: Add a raw SQL file under prisma/migrations/ with ALTER TYPE enum_name ADD VALUE 'NEW_VALUE'",
    "APPLIES_TO: Prisma + PostgreSQL projects using native enums"
  ]
}])
```

Link to relevant tech stack:

```json
create_relations([{
  "from": "GOTCHA:PrismaEnumMigration",
  "to": "BIZ:MentorX.me",
  "relationType": "applies_to"
}])
```

### Step 5: Post-Migration Verification

After running the migration:
- [ ] Verify row counts in affected tables
- [ ] Run the app against the new schema (smoke test)
- [ ] Confirm rollback script is ready if anomalies appear
- [ ] Update memory if a new gotcha was discovered

---

## Entity Naming Reference

```
GOTCHA:MigrationDescription     → incident-gotcha (migration-specific issue)
GOTCHA:DroppedColumnWithView    → incident-gotcha (view dependency trap)
INCIDENT:Project:MigFailure     → incident-bug (migration that caused production incident)
```
