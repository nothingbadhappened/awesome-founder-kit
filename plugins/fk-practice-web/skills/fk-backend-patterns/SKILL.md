---
name: fk-backend-patterns
description: Use when building or reviewing Node.js/TypeScript server code (Express, Fastify, Next.js route handlers) - layering, data access, N+1, transactions, caching, auth middleware, jobs, logging.
---

# Backend patterns (Node.js / TypeScript)

Project ADRs and standards win. Endpoint contracts: `fk-api-design`; errors: `fk-error-handling`; security: `fk-security-checklist`.

## 1. Layering

- **Route/controller**: parse + validate input (schema at the boundary), call one service method, map result/errors to HTTP. No business rules, no SQL.
- **Service**: business logic, orchestration, transactions. Receives repositories/clients via constructor or factory arguments.
- **Repository**: the only place that talks to the database; returns domain types, not driver rows. An interface per repository makes services testable with in-memory fakes.
- **Middleware / wrappers** for cross-cutting concerns: auth, request id, logging, rate limiting. Prefer a higher-order handler (`withAuth(handler)`, `requirePermission('delete')(handler)`) or framework middleware over copy-pasted checks.
- Reach for full ports-and-adapters (`fk-hexagonal-architecture`) only when the project's architecture ADR calls for it.

## 2. Data access

- Select only the columns you need; always bound list queries (`limit` + pagination).
- **N+1**: never query inside a loop over results. Batch (`WHERE id IN (...)`, ORM `include`/`in` queries, DataLoader for GraphQL) and join in memory with a `Map`.
- **Transactions** for multi-write invariants: use the driver/ORM transaction API (or a database function) so all writes commit or none do; keep transactions short and free of network calls to other services.
- Use a connection pool sized for the deployment (serverless needs a pooler such as PgBouncer or the platform's pooled URL).
- Index every column used in `WHERE`, `JOIN`, `ORDER BY` of hot queries; check with `EXPLAIN` (see `fk-postgres-patterns`).

## 3. Caching

- Cache-aside: read cache -> on miss read DB -> write cache with a TTL. Invalidate (delete key) on every write path to that entity.
- Key naming `entity:id[:variant]`; TTL on every key; never cache per-user data under a shared key.
- Cache only after measuring a hot path; caching adds a consistency problem. Details: `fk-redis-patterns`.
- HTTP caching (`Cache-Control`, `ETag`) for public, cacheable GETs.

## 4. Auth

- Verify tokens with the library's verify function and a key from configuration; reject on any verification error with 401.
- Authorization in one place: a role -> permissions map plus a `hasPermission(user, permission)` check, applied per route, and ownership checks inside the service for per-resource access.
- Fail closed: missing user/role means no access.

## 5. Rate limiting

Use a shared store (Redis, API gateway, platform limiter). Per-process in-memory counters reset on deploy, split across replicas and fail open on serverless; do not use them in production.

## 6. Background work

- Anything slow (emails, indexing, third-party calls, media) goes to a durable queue (BullMQ, SQS, Cloud Tasks, a DB-backed queue), not an in-memory array; the request returns 202/accepted.
- Jobs are idempotent (safe to retry), have a timeout, bounded retries with backoff, and a dead-letter path that is monitored.

## 7. Logging and observability

- Structured JSON logs with `timestamp`, `level`, `message`, `requestId`, `userId` (when known), route; use the project's logger (pino, winston) rather than `console.log`.
- Generate or propagate a request id per request and include it in every log line and error response.
- Log errors once, at the boundary that handles them, with the cause chain; never log secrets, tokens or full personal data.
- Expose health/readiness endpoints; emit metrics for latency, error rate and queue depth.

## 8. Review checklist

- [ ] Controllers thin; business logic in services; SQL only in repositories
- [ ] Input validated at the boundary; errors mapped centrally
- [ ] No N+1; every list query paginated or limited; indexes for hot filters
- [ ] Multi-write invariants inside a transaction
- [ ] Cache keys have TTLs and are invalidated on writes
- [ ] Auth + authorization on every non-public route
- [ ] Slow work queued; jobs idempotent with retries
- [ ] Structured logs with request ids, no sensitive data

_Source: adapted from ECC `skills/backend-patterns` (MIT); see NOTICE.md._
