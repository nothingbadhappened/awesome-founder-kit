---
name: fk-postgres-patterns
description: Use when designing PostgreSQL schemas, indexes or RLS policies, writing non-trivial SQL, or investigating a slow query, bloat or connection limits.
---

# PostgreSQL patterns

Project ADRs win (id strategy, multi-tenancy, hosting). Migrations: `fk-database-migrations`.

## Schema defaults

| Use | Prefer | Avoid |
|---|---|---|
| Primary keys | `bigint generated always as identity`, or time-ordered UUIDs (v7) when ids are public or generated client-side | random v4 UUIDs on very hot insert tables (index fragmentation) |
| Text | `text` + a `CHECK` on length if needed | `varchar(255)` by habit |
| Time | `timestamptz` | `timestamp` without zone |
| Money | `numeric(p,s)` or integer minor units | `float`/`real` |
| Flags | `boolean` | int/varchar flags |
| Closed sets | `CHECK (status IN (...))` or a lookup table | free text |

- Foreign keys declared and indexed; `NOT NULL` wherever a value is required; `created_at`/`updated_at` on business tables.

## Indexes

| Query shape | Index |
|---|---|
| `col = x`, ranges, sort | B-tree (default) |
| `a = x AND b > y` | composite `(a, b)`: equality columns first, then range |
| JSONB containment, arrays, full-text `@@` | GIN |
| Huge append-only time series | BRIN |
| Only a subset is queried (`WHERE deleted_at IS NULL`) | partial index |
| Avoid heap lookups for a hot read | covering index `... INCLUDE (cols)` |

- Every index costs write time and space; add one per real query shape, verified with `EXPLAIN (ANALYZE, BUFFERS)`.
- On existing large tables create indexes `CONCURRENTLY` (outside a transaction).

## Query patterns

- Upsert: `INSERT ... ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`.
- Keyset pagination: `WHERE (created_at, id) < (:last_created_at, :last_id) ORDER BY created_at DESC, id DESC LIMIT 20`; `OFFSET` degrades linearly.
- Job queue: `UPDATE jobs SET status = 'processing' WHERE id = (SELECT id FROM jobs WHERE status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`.
- Always parameterize; never interpolate input into SQL.
- Select needed columns only; avoid `SELECT *` in application queries.

## Row-level security (Supabase or multi-tenant)

- Enable RLS on every table exposed to clients; deny by default; one policy per operation.
- Wrap auth functions in a sub-select so they are evaluated once: `USING ((SELECT auth.uid()) = user_id)`; index the policy column.
- Test policies with a non-owner role, not only the service role.

## Operations

- `statement_timeout` and `idle_in_transaction_session_timeout` set (e.g. 30 s) for application roles.
- Enable `pg_stat_statements`; review the slowest mean and total time queries regularly.
- Use a pooler (PgBouncer or the platform's) for serverless or many app instances; size `max_connections` to memory.
- `REVOKE ALL ON SCHEMA public FROM public`; application role has only the privileges it needs; migrations run as a separate owner role.

## Diagnostics

- Unindexed foreign keys: query `pg_constraint` (contype `f`) for columns not covered by any `pg_index`.
- Slow queries: `SELECT query, mean_exec_time, calls FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 20`.
- Bloat / vacuum: `SELECT relname, n_dead_tup, last_autovacuum FROM pg_stat_user_tables ORDER BY n_dead_tup DESC`.
- Lock waits: `pg_stat_activity` where `wait_event_type = 'Lock'`.

## Review checklist

- [ ] Types per the table; constraints express the rules
- [ ] FKs indexed; each new index tied to a query and checked with EXPLAIN
- [ ] Pagination keyset for large/fast tables
- [ ] RLS on client-exposed tables, tested as a normal user
- [ ] Timeouts and pooling configured

_Source: adapted from ECC `skills/postgres-patterns` (MIT; itself based on Supabase agent skills, MIT); see NOTICE.md._
