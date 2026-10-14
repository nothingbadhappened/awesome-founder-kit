---
name: fk-error-handling
description: Use when designing error types, API error responses, retries, timeouts, circuit breakers or user-facing failure messages, or when reviewing code that catches or ignores errors.
---

# Error handling

Project standards win (error envelope, logging stack, Result vs exceptions). Defaults below.

## Principles

1. Fail at the boundary where the problem is detected; do not bury it.
2. Errors are typed values with a stable `code`, not ad-hoc strings.
3. Users see a friendly message; logs get the full context (ids, cause chain), never secrets or personal data.
4. Every catch handles, re-raises with added context, or logs; no silent swallowing, no empty catch.
5. Error codes a client can receive are part of the API contract; document them.

## Steps

1. **Define a small hierarchy** per service: base `AppError(message, code, status, details?)` plus `NotFound`, `Validation` (with field details), `Unauthorized`, `Forbidden`, `Conflict`, `RateLimited(retryAfter)`.
   - TypeScript: extend `Error`, set `name`, call `Object.setPrototypeOf(this, new.target.prototype)` so `instanceof` works after transpiling.
   - Python: subclass `Exception` with `code`/`status_code` attributes.
   - Go: sentinel errors (`var ErrNotFound = errors.New("not found")`), wrap with `fmt.Errorf("finding user %s: %w", id, err)`, test with `errors.Is/As`.
   - Rust: `thiserror` enums in libraries, `anyhow` with context in binaries.
2. **Expected failures** (parsing, lookups, external calls) may return a Result type (`{ ok: true, value } | { ok: false, error }`) instead of throwing, if the codebase already uses that style.
3. **One translation point per boundary**: a single API error handler maps `AppError` -> status + `{ error: { code, message, details? } }`, schema-validation errors -> 422 with field details, anything else -> log + 500 with a generic message. Infrastructure errors are translated to application errors in the adapter.
4. **UI**: wrap rendering trees in an error boundary with a fallback; map codes to user messages in one table, with a generic default.
5. **Retries**: retry only transient failures (network, timeouts, 5xx, 429 honoring `Retry-After`), never 4xx validation/auth errors. Exponential backoff with jitter and a cap (defaults: 3 attempts, 500 ms base, 10 s max). Only retry idempotent operations or ones with an idempotency key.
6. **Timeouts** on every outbound call; a call without a timeout is a bug.
7. **Circuit breaker** for a dependency that fails repeatedly: open after N consecutive failures, fail fast while open, half-open probe after a cool-down. Use a maintained library when one exists for the stack.
8. **Async work**: no fire-and-forget without an error path (log + metric, dead-letter queue for jobs).

## Review checklist

- [ ] No silent catch; context added when re-raising
- [ ] API errors use the project envelope; no stack traces or SQL in responses
- [ ] Full context logged server-side, secrets and personal data redacted
- [ ] Custom errors share a base type with a `code`
- [ ] Retries limited to transient errors, bounded, with backoff + jitter
- [ ] Every outbound call has a timeout
- [ ] UI has an error boundary and friendly messages

_Source: adapted from ECC `skills/error-handling` (MIT); see NOTICE.md._
