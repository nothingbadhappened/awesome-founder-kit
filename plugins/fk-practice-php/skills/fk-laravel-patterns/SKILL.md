---
name: fk-laravel-patterns
description: Use when building or reviewing Laravel apps - thin controllers with actions/services, scoped route bindings, Eloquent models and N+1, transactions, migrations, form requests, resources, queues.
---

# Laravel patterns

Project ADRs win (actions vs services, API envelope, packages). Security: `fk-laravel-security`; tests: `fk-laravel-testing`; migration safety: `fk-database-migrations` (web pack).

## Layout

`app/Actions` (single-purpose use cases), `app/Services` (coordinating domain services), `app/Http/{Controllers,Middleware,Requests,Resources}`, `app/Models`, `app/Policies`, `app/Jobs`, `app/Events`, `app/Providers`; `database/{factories,migrations,seeders}`; `routes/{api,web,console}.php`.

## Request flow

1. **Route**: resource routes (`Route::apiResource`) inside the right middleware group (`auth:sanctum`, throttle); `Route::scopeBindings()` for nested resources so `/accounts/{account}/projects/{project}` only resolves a project of that account. Parameter names match the bound model.
2. **Form request**: `authorize()` via policies (`$this->user()?->can('create', Order::class) ?? false`), `rules()` with specific rules, and a `toDto()` built from `validated()` data.
3. **Controller**: thin; constructor-injects an action/service, passes the DTO, returns a resource with the right status (201 on create).
4. **Action/service**: business logic; wraps multi-step writes in `DB::transaction(...)`; dispatches events/jobs for side effects (after commit: `afterCommit` on jobs/listeners).
5. **Resource**: `JsonResource`/collections shape the response; consistent envelope and pagination meta per the project's API standard.

## Container

Bind interfaces to implementations in a service provider (`$this->app->bind(OrderRepository::class, EloquentOrderRepository::class)`); constructor injection everywhere; avoid resolving from the container inside domain code.

## Eloquent

- `$fillable` allow-lists (never `$guarded = []`), `$casts` for enums, dates, money value objects (`Attribute::make(get:, set:)` or custom casts), `$hidden` for secrets.
- Relationships typed (`BelongsTo`, `HasMany`); local scopes (`scopeActive`) for reusable filters; global scopes only for true defaults, and not duplicated by a local scope.
- N+1: eager load (`with(['customer', 'items.product'])`), enable `Model::preventLazyLoading(!app()->isProduction())`.
- Paginate lists (`paginate(25)` or `cursorPaginate` for large tables); `chunkById`/`lazy` for batch processing.
- Query objects or scopes for complex filters; clone builders when composing.
- `SoftDeletes` for recoverable records.

## Migrations

- Anonymous-class migrations with `up()` and `down()`; snake_case plural tables; `foreignId()->constrained()` with a deliberate `onDelete`; indexes on filtered columns.
- Follow expand-contract for renames and new `NOT NULL` columns on live tables.

## Queues, events, caching

- Slow or external work in queued jobs: idempotent, `tries`/`backoff`/`retryUntil` set, failures monitored (`failed_jobs`, Horizon).
- Domain events for side effects (mail, analytics, webhooks) with queued listeners.
- Cache read-heavy queries with `Cache::remember(key, ttl, fn)`; invalidate on model events; tags only on drivers that support them (Redis/Memcached).

## Configuration

- Secrets in environment variables (`.env` locally, platform secret store in production); `config/*.php` reads `env()`; application code reads `config()`, never `env()` directly (breaks under `config:cache`).
- Production deploy runs `config:cache`, `route:cache`, `view:cache`, and migrations with `--force` in the deploy step.

## Review checklist

- [ ] Thin controllers; validation and authorization in form requests/policies
- [ ] Scoped bindings for nested resources
- [ ] `$fillable`, casts, hidden attributes set; no lazy-loading N+1
- [ ] Multi-step writes in transactions; side effects after commit
- [ ] Lists paginated; jobs idempotent with retries
- [ ] No `env()` outside config files

_Source: adapted from ECC `skills/laravel-patterns` (MIT); see NOTICE.md._
