---
name: fk-quarkus-patterns
description: Use when building or reviewing a Quarkus 3.x service - REST resources, CDI services, Panache, validation and exception mappers, Camel messaging, caching, config profiles, health, native builds.
---

# Quarkus patterns

Project ADRs win (RESTEasy Reactive vs classic, Panache style, messaging stack, Lombok or not).

## Layers

- **Resource** (`@Path`, `@Produces/@Consumes(APPLICATION_JSON)`): `@Valid` request records, returns DTOs; `201 Created` with a `Location` from `UriInfo`; 404 via `Optional` mapping. No business logic.
- **Service** (`@ApplicationScoped`): constructor injection (plain constructor, or Lombok `@RequiredArgsConstructor` if the project uses Lombok); `@Transactional` on methods that write; keep transactions short and do not start async work or remote calls inside them.
- **Repository**: `PanacheRepository<Entity>` with intent methods (`findByStatus(status, page, size)` using `find("status = ?1 order by createdAt desc", status).page(page, size).list()`, `firstResultOptional()`). Choose repository or active-record style once per project.
- DTOs as `record`s with Bean Validation; static `from(entity)` mappers.

## Errors

- `@Provider` `ExceptionMapper`s: `ConstraintViolationException` -> 400 with field messages; domain not-found -> 404; generic `Exception` -> log with stack trace, return a generic 500 body.
- Consistent error envelope per `fk-error-handling`.

## Messaging and integration (Apache Camel, when used)

- Publish through a `ProducerTemplate` to a `direct:` route; the route marshals (Jackson) and sends to the broker (RabbitMQ/Kafka component) with connection settings from `@ConfigProperty`.
- In routes: `onException(...)` handlers, `routeId`s for observability, `choice().when(...)` for content-based routing, file consumers with `move`/`moveFailed` directories.
- Consumers are idempotent; decide at-least-once handling and dead-letter routes explicitly.
- Do not log whole message bodies containing personal data.
- An audit/event table (success/error events per operation) is useful for regulated or document-processing domains; add it when the project needs traceability, not by default.

## Async

- `CompletableFuture.supplyAsync(..., managedExecutor)` with an injected executor (`ManagedExecutor`), propagating logging/trace context; handle exceptions in the future chain.
- Prefer reactive (Mutiny) end to end if the project chose RESTEasy Reactive with reactive clients; do not block event-loop threads (`@Blocking` where needed).

## Caching

`@CacheResult(cacheName = "...")` with `@CacheKey`, `@CacheInvalidate`/`@CacheInvalidateAll` on writes; a distributed cache for multi-instance deployments.

## Configuration

- Profiles `%dev`, `%test`, `%prod` (properties or `quarkus-config-yaml`); secrets as `${ENV_VAR}` placeholders; typed config with `@ConfigMapping` or `@ConfigProperty`.
- Hibernate schema: `drop-and-create` only in dev/test; `validate` (or none) in production with Flyway/Liquibase migrations.

## Observability and operations

- Structured JSON logs (`quarkus-logging-json` or Logback with a Logstash encoder) with MDC context (request id, document id); no secrets in logs.
- SmallRye Health: `@Readiness` checks for the database/broker, `@Liveness` for the app/Camel context.
- Metrics via Micrometer; tracing via OpenTelemetry.
- Dev mode for local work; build and test the native image periodically if native is a target (reflection config for serialized classes).

## Testing

- `@QuarkusTest` with Dev Services/Testcontainers for real databases and brokers; REST Assured for resources; `@InjectMock` for collaborators.
- Camel routes with `camel-quarkus-junit5` and mock endpoints; test each `choice()` branch and error route.

## Review checklist

- [ ] Thin resources, validated DTOs, exception mappers in place
- [ ] Transactions short, no async/remote calls inside
- [ ] Migrations manage schema; `validate` in production
- [ ] Message handlers idempotent with dead-letter handling
- [ ] Secrets externalized; health checks and structured logs present

_Source: adapted from ECC `skills/quarkus-patterns` (MIT); see NOTICE.md._
