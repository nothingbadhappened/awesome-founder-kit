---
name: fk-database-migrations
description: Use when writing a schema or data migration, adding a column/index to a large table, renaming or dropping columns, planning a rollback, or preparing a zero-downtime deploy.
---

# Database migrations

Tool-specific commands are in [reference.md](reference.md) (Prisma, Drizzle, Kysely, Django, golang-migrate); read it at step 4.

## Principles

1. Every schema change is a migration file in version control; no manual changes to shared databases.
2. Production is forward-only: undo with a new migration, not by editing or rolling back history.
3. Schema (DDL) and data (DML/backfill) changes live in separate migrations.
4. Applied migrations are immutable.
5. Test against production-sized data: a statement that is instant on 100 rows can lock 10 M rows.

## Steps

1. **Classify the change**: additive (new table, nullable column, column with constant default), index, destructive (drop/rename/type change, new `NOT NULL`), or data backfill.
2. **Pick the safe pattern**:
   - Add column: nullable, or `NOT NULL DEFAULT <constant>` (instant on Postgres 11+). Never `NOT NULL` without default on a populated table.
   - Add index on an existing large table: `CREATE INDEX CONCURRENTLY` (cannot run inside a transaction; most tools need a raw/no-transaction migration).
   - Rename or retype: expand-contract (below), never a direct rename in production.
   - Drop column: remove all code references and deploy first; drop in a later migration (Django: `SeparateDatabaseAndState` to remove from the model first).
   - Backfill: separate data migration, in batches (e.g. 1-10 k rows, `FOR UPDATE SKIP LOCKED`, commit per batch), idempotent and restartable.
3. **Expand-contract** for zero-downtime changes:
   - Expand: add the new column/table; app writes both old and new; backfill existing rows.
   - Migrate: app reads new, still writes both; verify consistency.
   - Contract: app uses only new; drop the old structure in a separate, later migration.
4. **Write it** with the project's tool (see [reference.md](reference.md)); include a down migration or mark it explicitly irreversible.
5. **Check before merge**:
   - [ ] Up and down (or marked irreversible) present
   - [ ] No long table locks on large tables; lock/statement timeouts set for the migration session where supported
   - [ ] Schema and data changes separated
   - [ ] Run on a copy of production-sized data (or estimate row counts and lock behaviour)
   - [ ] Deploy order written: which app version must be live before/after
   - [ ] Rollback plan stated (forward fix or restore point)
6. **Deploy**: CI applies migrations with the non-interactive command (`migrate deploy`, `migrate up`, `manage.py migrate`) before or after the app per the deploy order; take a backup or confirm point-in-time recovery for destructive steps.

## Anti-patterns

| Anti-pattern | Instead |
|---|---|
| Manual SQL in production | Migration file |
| Editing an applied migration | New migration |
| `NOT NULL` without default on a live table | Nullable -> backfill -> add constraint |
| Inline index build on a large table | `CONCURRENTLY` |
| Schema + data in one migration | Two migrations |
| Dropping a column still read by running code | Remove code, deploy, then drop |
| Dev-only reset/push commands against shared databases | Generate and deploy migrations |

_Source: adapted from ECC `skills/database-migrations` (MIT); see NOTICE.md._
