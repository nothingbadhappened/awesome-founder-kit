---
name: fk-springboot-patterns
description: Use when building or reviewing a Spring Boot service - controller/service/repository layers, DTO validation, error handling, transactions, JPA, caching, async work, rate limits and observability.
---

# Spring Boot patterns

Project ADRs win (MVC vs WebFlux, persistence, messaging). Security: `fk-springboot-security`; tests: `fk-springboot-testing`.

## Layers

- **Controller** (`@RestController`): maps HTTP to service calls, `@Valid` on request bodies, returns DTOs with the right status (`ResponseEntity.status(CREATED)`), no business logic or repository access.
- **Service** (`@Service`): business logic and transactions; constructor injection only (no field `@Autowired`).
- **Repository** (Spring Data `JpaRepository` or JDBC): derived queries or `@Query` with named parameters; returns entities to the service, never to the controller.
- DTOs as Java `record`s with Bean Validation (`@NotBlank @Size(max=200)`, `@NotNull @FutureOrPresent`, `@NotEmpty List<@NotBlank String>`); static `from(entity)` mappers.

## Errors

- One `@RestControllerAdvice` maps exceptions: `MethodArgumentNotValidException` -> 400/422 with field errors, not-found -> 404, `AccessDeniedException` -> 403, everything else -> logged with stack trace + generic 500.
- Enable RFC 7807 problem details (`spring.mvc.problemdetails.enabled=true`) or follow the project's error envelope consistently.

## Data access (JPA)

- `@Transactional` on service methods that write; `@Transactional(readOnly = true)` for queries; keep transactions short with no remote calls inside.
- Avoid N+1: fetch joins / `@EntityGraph` for needed associations, `LAZY` by default, DTO projections for read-heavy endpoints; turn on SQL logging or Hibernate statistics in dev to check.
- Pagination with `Pageable`/`PageRequest.of(page, size, Sort.by("createdAt").descending())`; cap `size`.
- Schema changes via Flyway or Liquibase migrations; `ddl-auto` is `validate` (or `none`) outside throwaway local setups.
- HikariCP pool size and timeouts tuned to the workload and database limits.

## Caching and async

- `@EnableCaching` + `@Cacheable(value="market", key="#id")` / `@CacheEvict` on writes; use a shared cache (Redis) when running more than one instance.
- `@EnableAsync` with a bounded, named `ThreadPoolTaskExecutor` (not the default unbounded one); `@Async` methods return `CompletableFuture` and handle their own errors.
- Background jobs: `@Scheduled` only for single-instance or lock-protected jobs (ShedLock); otherwise a queue (Kafka, RabbitMQ, SQS). Handlers are idempotent.

## Outbound calls

- Timeouts on every client (`RestClient`/`WebClient` connect + read timeouts).
- Retries with backoff and circuit breaking through Resilience4j (or Spring Retry), only for transient failures; restore the interrupt flag if you ever catch `InterruptedException`.

## Rate limiting

- Prefer the gateway/platform limiter; in-app use Bucket4j backed by a shared store for multi-instance deployments.
- Identify clients with `request.getRemoteAddr()`; trust `X-Forwarded-For` only behind a configured trusted proxy (`server.forward-headers-strategy` + trusted proxies), since clients can spoof it.

## Observability

- SLF4J with structured JSON output (Logback encoder), key=value context (`log.info("generate_report marketId={}", id)`), never secrets.
- Request logging/correlation via a `OncePerRequestFilter` and MDC.
- Micrometer metrics (Prometheus/OTel) and tracing; Actuator health/readiness exposed only on a management port or protected path.

## Configuration

- Profiles (`application-{profile}.yml`) for environment differences; secrets as `${ENV_VAR}` placeholders or a vault, never literal.
- `@ConfigurationProperties` records for typed config with validation.

## Review checklist

- [ ] Thin controllers, constructor injection, DTOs validated with `@Valid`
- [ ] Central exception handling; no stack traces in responses
- [ ] Transactions on services; read-only for queries; no N+1
- [ ] Migrations manage the schema; `ddl-auto` not `update` in shared environments
- [ ] Timeouts, bounded executors, idempotent jobs
- [ ] Structured logs, metrics, protected actuator

_Source: adapted from ECC `skills/springboot-patterns` (MIT); see NOTICE.md._
