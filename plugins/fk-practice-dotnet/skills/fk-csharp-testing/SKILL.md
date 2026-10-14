---
name: fk-csharp-testing
description: Use when writing or fixing C#/.NET tests - xUnit facts and theories, assertions, NSubstitute/Moq, WebApplicationFactory API tests, Testcontainers, test data builders, coverage and filters.
---

# C# testing

Use the project's framework (xUnit, NUnit or MSTest) and assertion/mocking libraries consistently. For test-first work OMC's `tdd` workflow drives the cycle. Coverage thresholds are the project's decision.

## Organization

```
tests/MyApp.UnitTests/        Services/, Validators/
tests/MyApp.IntegrationTests/ Api/, Repositories/
tests/MyApp.TestHelpers/      Builders/, Fixtures/
```

## Unit tests

1. One test class per unit; the system under test (`_sut`) built in the constructor (xUnit creates a fresh instance per test, so no shared mutable state).
2. Names: `Method_ExpectedResult_WhenCondition` (e.g. `PlaceOrderAsync_ReturnsFailure_WhenNoItems`).
3. Arrange / act / assert; one logical assertion per test (several asserts on one outcome are fine).
4. `[Theory]` with `[InlineData]` for simple tables, `[MemberData]`/`TheoryData<T1, T2>` for object cases.
5. Assert on typed properties, not `ToString()`; use the project's assertion library (FluentAssertions/Shouldly or xUnit `Assert`). Check the license terms of assertion libraries before adding one.
6. Pass `CancellationToken.None` or a test token explicitly; add a test that cancellation is honoured where it matters.

## Mocking

- NSubstitute (`Substitute.For<IOrderRepository>()`, `.Returns(...)`, `await repo.Received(1).AddAsync(Arg.Is<Order>(o => ...), Arg.Any<CancellationToken>())`) or Moq, whichever the project uses.
- Mock boundaries (repositories, gateways, clocks via `TimeProvider`), not the class under test or simple value types.
- Loggers: `NullLogger<T>.Instance` unless the test asserts on logging.

## API integration tests

- `WebApplicationFactory<Program>` as an `IClassFixture`; override services in `WithWebHostBuilder(b => b.ConfigureServices(...))` (replace external clients with fakes, the database with a test instance).
- Prefer a real database engine via Testcontainers (`PostgreSqlBuilder().WithImage("postgres:<pinned>")`, `IAsyncLifetime` for start/stop, `Database.MigrateAsync()`) over the EF in-memory provider, which does not enforce relational behaviour.
- Cover status codes (201 + `Location`, 400/422 validation, 401/403, 404), response bodies (`ReadFromJsonAsync<T>()`), and problem-details shape.
- Authentication in tests via a test auth handler that issues known claims.

## Test data

- Builders with sensible defaults and fluent overrides (`new OrderBuilder().WithCustomer("vip").WithItem("SKU", 3, 99.99m).Build()`); Bogus for realistic bulk data with a fixed seed.

## Async and timing

- `async Task` tests (never `async void`); no `Thread.Sleep`; inject `TimeProvider` (`FakeTimeProvider`) for time-dependent code; poll with a timeout for eventual consistency.

## Commands

```bash
dotnet test
dotnet test tests/MyApp.UnitTests/
dotnet test --filter "FullyQualifiedName~OrderService"
dotnet test --collect:"XPlat Code Coverage"   # coverlet; report with reportgenerator
dotnet watch test --project tests/MyApp.UnitTests/
```

## Anti-patterns

- Testing implementation details or private methods.
- Shared static state across tests; order-dependent tests.
- EF in-memory provider standing in for relational behaviour.
- Ignoring flaky tests instead of fixing their timing source.

_Source: adapted from ECC `skills/csharp-testing` (MIT); see NOTICE.md._
