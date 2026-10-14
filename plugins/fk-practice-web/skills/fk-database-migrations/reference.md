# Migration tools (reference)

Read from `fk-database-migrations` step 4. Run CLIs through the project's locked local install (`npx --no-install <tool>`, `pnpm exec`, the virtualenv), never an ad-hoc unpinned download.

## PostgreSQL snippets

```sql
-- add column safely
ALTER TABLE users ADD COLUMN avatar_url text;
ALTER TABLE users ADD COLUMN is_active boolean NOT NULL DEFAULT true;  -- instant on PG 11+

-- index without blocking writes (outside a transaction)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);

-- batched backfill (PG 11+ procedure-style loop with COMMIT; run outside an explicit transaction)
DO $$
DECLARE n int;
BEGIN
  LOOP
    UPDATE users SET normalized_email = lower(email)
    WHERE id IN (SELECT id FROM users WHERE normalized_email IS NULL LIMIT 10000 FOR UPDATE SKIP LOCKED);
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0;
    COMMIT;
  END LOOP;
END $$;
```

## Prisma

- Local only: `prisma migrate dev --name <change>` (may reset a drifted DB).
- Custom SQL (concurrent index, backfill): `prisma migrate dev --create-only --name <change>`, then edit `migration.sql` before applying.
- Shared/staging/production: `prisma migrate deploy`. Drift check: `prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url <shadow>`.
- `prisma migrate reset` is dev-only. Run `prisma generate` after schema changes.

## Drizzle

- `drizzle-kit generate` creates SQL from schema changes; `drizzle-kit migrate` applies them.
- `drizzle-kit push` writes the schema directly without a migration file: local prototyping only.

## Kysely (kysely-ctl)

- `kysely migrate make <name>`, `kysely migrate latest`, `kysely migrate down`, `kysely migrate list`.
- Migration functions take `Kysely<any>`, not the app's typed DB interface; migrations are frozen in time.
- Programmatic: `new Migrator({ db, provider: new FileMigrationProvider({ fs, path, migrationFolder }) }).migrateToLatest()`; exit non-zero on error. Keep `allowUnorderedMigrations` off outside development.

## Django

- `python manage.py makemigrations`, `migrate`, `showmigrations`; `makemigrations --empty <app> -n <name>` for custom SQL or data.
- Data migrations: `migrations.RunPython(forward, reverse)` using `apps.get_model(...)` (historical models), batch with `bulk_update(batch, fields, batch_size=...)`.
- Remove a field from the model before dropping the column:
  `migrations.SeparateDatabaseAndState(state_operations=[migrations.RemoveField(...)], database_operations=[])`, then drop in a later migration.
- Concurrent index: `AddIndexConcurrently` (from `django.contrib.postgres.operations`) in a migration with `atomic = False`.

## golang-migrate

- `migrate create -ext sql -dir migrations -seq <name>` creates `NNN_name.up.sql` / `.down.sql`.
- `migrate -path migrations -database "$DATABASE_URL" up`; `down 1` to step back in non-production; `force <version>` only to repair a dirty state after investigating.
- Put `CREATE INDEX CONCURRENTLY` in its own migration file (no multi-statement transaction).

## Zero-downtime timeline example

```
Day 1  migration adds new_status (nullable); app v2 writes status + new_status
Day 2  backfill migration for existing rows
Day 3  app v3 reads new_status only (still writes both)
Day 7  migration drops status after v3 is stable
```
