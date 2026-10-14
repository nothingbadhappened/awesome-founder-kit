---
name: fk-prisma-patterns
description: Use when writing a Prisma schema or query, or debugging Prisma transactions, migrations, bulk updates or serverless connection limits - schema defaults, DTOs, N+1 and known traps.
---

# Prisma patterns

Check the installed Prisma version first (`prisma --version` via the project's local binary). Newer versions may need a driver adapter (e.g. `@prisma/adapter-pg`) and keep the datasource URL in `prisma.config.ts`; follow what the compiler and the project's setup require.

## Schema

- Ids: `cuid()` as a default for app ids; `uuid()` when other systems need UUIDs; `autoincrement()` for internal/join tables (do not expose counts publicly). Follow the project's ADR if it chose otherwise.
- `@@index` on every foreign key and every column used in `where`/`orderBy` of hot queries (`@unique` already indexes).
- `createdAt @default(now())`, `updatedAt @updatedAt`; add `deletedAt DateTime?` up front if soft delete is foreseeable.

## Queries

- `select` for hot paths and wide tables; `include` when you need most fields plus a relation.
- Map entities to response DTOs; never return raw Prisma objects from an API (leaks fields like password hashes).
- No queries in loops (N+1): use `include`/nested `select` or one `findMany({ where: { id: { in: ids } } })`. With `relationJoins`, benchmark large 1:N includes (row explosion).
- Cursor pagination: `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`, `take: limit + 1`, `cursor: { id }, skip: 1`; pop the extra item to compute `nextCursor`.
- Soft delete: filter `deletedAt: null` explicitly in each query (or a reviewed client extension); use `findFirstOrThrow({ where: { id, deletedAt: null } })`, because `findUniqueOrThrow` returns soft-deleted rows.

## Transactions

| Situation | Form |
|---|---|
| Independent writes | array form `prisma.$transaction([a, b])` |
| Later step needs earlier result | interactive `prisma.$transaction(async (tx) => ...)`; use only `tx` inside |
| Email/HTTP/other external calls | outside the transaction |

Interactive transactions time out after 5 s by default; raise `timeout` only for genuine bulk work.

## Client

- One `PrismaClient` per process (module singleton cached on `globalThis` in dev to survive hot reload).
- Serverless: `connection_limit=1` (and `pool_timeout`) in the `DATABASE_URL` query string plus an external pooler (`pgbouncer=true` or the platform pooler).

## Errors

Catch `Prisma.PrismaClientKnownRequestError` at the service boundary and translate: `P2002` unique violation -> conflict; `P2025` not found -> not found; `P2003` FK violation -> bad request. Never expose raw Prisma messages.

## Traps

- `updateMany`/`deleteMany` return `{ count }`, not rows. Select target ids first, update by `id in`, re-fetch if you need the rows.
- `@updatedAt` is not set by `updateMany`; set `updatedAt: new Date()` yourself.
- `deleteMany()` without `where` deletes the whole table; always pass a `where`.
- `migrate dev` may offer to reset the database on drift; use it only on a local solo database. Shared/staging/production use `migrate deploy`. Check drift with `migrate diff`.
- Never edit an applied migration (checksum mismatch `P3006` everywhere it ran); add a new one.
- Prisma cannot generate `CREATE INDEX CONCURRENTLY` or batched backfills: create an empty migration with `--create-only` and write the SQL; follow expand-contract from `fk-database-migrations` for `NOT NULL` additions and renames.

## Review checklist

- [ ] Indexes for FKs and hot filters
- [ ] DTO mapping at the API boundary
- [ ] No N+1; cursor pagination with a unique tie-breaker
- [ ] External calls outside transactions
- [ ] `migrate deploy` in CI/CD; no edited applied migrations
- [ ] Bulk operations scoped and `updatedAt` handled

_Source: adapted from ECC `skills/prisma-patterns` (MIT); see NOTICE.md._
