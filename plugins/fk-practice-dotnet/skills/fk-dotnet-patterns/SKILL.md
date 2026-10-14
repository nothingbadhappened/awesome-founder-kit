---
name: fk-dotnet-patterns
description: Use when writing or reviewing C#/.NET code - records and nullability, DI and options, async with cancellation, Result vs exceptions, EF Core repositories, minimal APIs, middleware, guard clauses.
---

# .NET patterns (C#)

The project's target framework, analyzers (`.editorconfig`, `TreatWarningsAsErrors`) and standards win. Tests: `fk-csharp-testing`.

## Types and nullability

- `<Nullable>enable</Nullable>` everywhere; honour the warnings instead of `!`-suppressing them.
- Data: `sealed record` value objects (`record Money(decimal Amount, string Currency)`), DTOs with `required` + `init` properties and `IReadOnlyList<T>` collections. Mutable models only where a framework (e.g. EF Core entities) needs them, with invariants enforced through methods.
- Explicit access modifiers; `sealed` by default for classes not designed for inheritance; no public fields.

## Dependency injection and configuration

- Constructor injection (primary constructors are fine); depend on interfaces at service boundaries; never `new` services inside other services.
- Lifetimes chosen deliberately: `AddScoped` for per-request (DbContext, repositories), `AddSingleton` for stateless/thread-safe, `AddTransient` for lightweight; never inject scoped into singleton.
- Options pattern: `sealed class SmtpOptions { const string SectionName = "Smtp"; required ... }` bound with `builder.Services.AddOptions<SmtpOptions>().Bind(section).ValidateDataAnnotations().ValidateOnStart()`; secrets from environment, user-secrets (dev) or a vault, never `appsettings.json`.

## Async

- Async all the way; every async method takes and forwards a `CancellationToken`; suffix `Async`.
- Never `.Result`, `.Wait()` or `GetAwaiter().GetResult()` on tasks in app code (deadlocks, thread starvation).
- No `async void` except event handlers.
- Independent work concurrently with `Task.WhenAll`; bounded parallelism with `Parallel.ForEachAsync` or `SemaphoreSlim`.
- Outbound HTTP via `IHttpClientFactory` with timeouts and resilience handlers (`Microsoft.Extensions.Http.Resilience` / Polly).

## Errors

- Guard clauses at the top: `ArgumentNullException.ThrowIfNull(x)`, `ArgumentOutOfRangeException.ThrowIfNegativeOrZero(amount)`.
- Expected business failures: a `Result<T>` type (or the project's chosen library); exceptions for exceptional cases.
- Map errors to HTTP once: `IExceptionHandler` / `UseExceptionHandler` + `ProblemDetails`; never swallow with empty `catch (Exception)`.

## Data access (EF Core)

- Repositories (or direct DbContext use if the project chose that) return domain types; read queries `AsNoTracking()`, `Include` only what is needed or project to DTOs with `Select`.
- Avoid N+1 (eager load or projection), paginate lists, pass cancellation tokens to `ToListAsync`/`SaveChangesAsync`.
- Schema via EF migrations applied in deployment (bundle or script), not `EnsureCreated` in production.

## Web APIs

- Minimal APIs grouped with `MapGroup("/api/orders").RequireAuthorization().WithTags("Orders")`, returning `TypedResults` (`Ok`, `NotFound`, `Created(location, value)`, `ValidationProblem`). Controllers are fine where the project uses them; keep them thin.
- Validate requests (FluentValidation or data annotations + endpoint filters).
- Middleware for cross-cutting concerns (timing, correlation id) with structured logging templates: `_logger.LogInformation("Request {Method} {Path} took {ElapsedMs}ms", ...)` (no string interpolation in log calls).
- Health checks (`AddHealthChecks`), OpenTelemetry for traces/metrics.

## Anti-patterns

| Bad | Good |
|---|---|
| `async void` | return `Task` |
| `.Result` / `.Wait()` | `await` |
| empty `catch (Exception)` | handle, or rethrow with context |
| `new Service()` in constructors | DI |
| mutable static state | DI-scoped state, or thread-safe collections |
| `dynamic` in business logic | explicit types / generics |
| interpolated strings in log calls | message templates |

## Review checklist

- [ ] Nullable enabled, no unjustified `!`
- [ ] Cancellation tokens flow through async paths; no sync-over-async
- [ ] Options validated on start; no secrets in config files
- [ ] Central ProblemDetails error handling
- [ ] EF queries no-tracking/projections, paginated, no N+1
- [ ] Analyzers and formatting (`dotnet format --verify-no-changes`) clean

_Source: adapted from ECC `skills/dotnet-patterns` (MIT); see NOTICE.md._
