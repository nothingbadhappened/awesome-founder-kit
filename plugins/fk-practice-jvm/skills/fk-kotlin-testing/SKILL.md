---
name: fk-kotlin-testing
description: Use when writing or fixing Kotlin tests - Kotest specs and matchers, MockK (incl. suspend functions), coroutine and Flow tests, property and data-driven tests, Ktor testApplication, Kover coverage.
---

# Kotlin testing

Use the project's framework (Kotest or JUnit 5 + kotlin.test) consistently; do not mix two styles in one module. For test-first work OMC's `tdd` workflow drives the cycle. Coverage thresholds are the project's decision.

## Structure

- Kotest spec style chosen once per project: `FunSpec` (JUnit-like) as a default, `BehaviorSpec` for Given/When/Then domains, `StringSpec` for small utilities, `DescribeSpec` for nested contexts.
- Names describe behaviour: `"getUser throws when not found"`.
- Fixtures: `beforeTest`/`afterTest`, `beforeSpec`/`afterSpec`, or reusable listeners/extensions registered with `register(...)`; use real `data class` instances as fixtures, never mocks of data classes.

## Assertions

- `shouldBe`, `shouldNotBe`, `shouldContain`, `shouldHaveSize`, `shouldBeInstanceOf<T>()`, `shouldNotBeNull()`, `shouldBeInRange`.
- Exceptions: `shouldThrow<IllegalArgumentException> { ... }.message shouldBe "..."`; `Result` matchers `shouldBeSuccess`/`shouldBeFailure`.
- Custom `Matcher<T>` for repeated domain assertions.

## MockK

- `mockk<Repo>()` strict by default; `relaxed = true` only for fire-and-forget collaborators like loggers.
- `every { ... } returns ...` / `coEvery { ... } returns ...` for suspend functions; `coAnswers { ... }` for behaviour.
- Verify meaningful interactions: `verify(exactly = 1) { ... }`, `coVerify { ... }`; capture args with `slot<T>()` + `capture(slot)`.
- `clearMocks(...)` in `beforeTest` when mocks are shared across tests in a spec.
- `spyk` only for legacy seams; prefer injecting a fake.

## Coroutines and Flow

- `runTest { }` (kotlinx-coroutines-test) with virtual time: `advanceTimeBy`, `advanceUntilIdle`; inject a `StandardTestDispatcher`.
- Flows: `take(n).toList()` for finite checks, or Turbine `test { awaitItem() ... }`; test debounce by emitting and advancing time.
- Timeouts tested with `withTimeout` inside `runTest`; never `Thread.sleep`.

## Property and data-driven tests

- `forAll`/`checkAll` with `Arb` generators for pure functions: round-trips (serialize/deserialize), idempotence (sort twice), invariants; custom `Arb.bind(...)` generators for domain types.
- `withData(...)` (kotest-framework-datatest) for tables of valid/invalid inputs with readable names.

## Integration

- Ktor: `testApplication { application { configureRouting(); configureSerialization() }; client.get("/users") }`; assert status and decoded body.
- Databases: Testcontainers for the production engine; H2 only when the project accepts the difference.
- Spring + Kotlin: see `fk-springboot-testing` for slice tests.

## Coverage and static checks

- Kover: `./gradlew koverHtmlReport`, `koverXmlReport` for CI, `koverVerify` with the project's agreed minimum; exclude generated and config classes.
- `./gradlew detekt`, `ktlintCheck` (or the configured formatter) alongside tests.

## Commands

`./gradlew test`, `./gradlew test --tests "com.example.UserServiceTest"`, `./gradlew test --continuous`.

## Anti-patterns

- Mixing frameworks; mocking data classes; testing private functions.
- Real delays in coroutine tests; ignoring flaky tests instead of fixing the timing source.

_Source: adapted from ECC `skills/kotlin-testing` (MIT); see NOTICE.md._
