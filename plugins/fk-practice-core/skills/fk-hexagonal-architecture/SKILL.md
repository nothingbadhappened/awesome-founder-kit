---
name: fk-hexagonal-architecture
description: Use when introducing or refactoring toward ports and adapters, or when domain logic is tangled with HTTP, ORM, queue or SDK code - boundaries, ports, adapters, composition root, tests.
---

# Hexagonal architecture (ports and adapters)

Use only where the project's architecture ADR calls for it or a slice is hard to change/test because I/O and rules are mixed. Small CRUD apps do not need it.

## Concepts

- **Domain**: entities, value objects, rules. No framework, ORM or SDK imports.
- **Use case** (application layer): orchestrates one business operation with explicit input/output types.
- **Inbound port**: what the app can do (use-case interface). **Outbound port**: what the app needs (repository, gateway, clock, id generator, event publisher). Model capabilities, not technologies (`PaymentGatewayPort`, not `StripePort`).
- **Adapters**: HTTP controllers, CLI, queue consumers (inbound); DB repositories, API clients (outbound).
- **Composition root**: the one place that builds adapters and injects them into use cases.
- Dependencies point inward: adapters -> application -> domain. Domain depends on nothing external.

## Steps

1. Pick one use case; define its input/output DTOs. Keep `req`, `res`, GraphQL context and job envelopes outside.
2. List every side effect and define an outbound port for each.
3. Implement the use case with constructor/argument injection of ports; it validates invariants, calls domain logic, returns plain data.
4. Write adapters at the edge: inbound maps protocol -> use-case input and errors -> protocol; outbound maps ports -> ORM/SDK. Mapping stays in adapters.
5. Wire everything in the composition root; no hidden singletons or service locators.
6. Test per boundary (below).

## Layout (feature-first)

```text
src/features/orders/
  domain/            Order, OrderPolicy
  application/       ports/inbound, ports/outbound, use-cases/
  adapters/          inbound/http, outbound/postgres, outbound/payments
  composition/       ordersContainer
```

Per stack: Java/Kotlin packages `domain`, `application.port.in|out`, `application.usecase`, `adapter.in|out` (framework annotations optional on use cases); Go `internal/<feature>/{domain,application,adapters}` with small interfaces owned by the consumer and wiring in `cmd/<app>/main.go`.

## Anti-patterns

- Domain entities importing ORM models, web types or SDK clients.
- Use cases reading `req`/`res` or queue metadata.
- Returning DB rows from use cases without mapping.
- Adapters calling each other directly instead of through a use case.
- Wiring scattered across files via global singletons.

## Migrating an existing system

1. Choose one high-churn, low-blast-radius vertical slice (one endpoint or job).
2. Add characterization tests for current behaviour first.
3. Wrap existing infrastructure calls behind outbound ports (facade first).
4. Move orchestration from controller/service into the use case; old entry points delegate to it.
5. Keep a reversible switch per migrated slice until behaviour is verified in production.
6. Repeat slice by slice; never a big-bang rewrite. Record the target architecture as an ADR.

## Testing

- Domain: pure unit tests, no mocks.
- Use cases: in-memory fakes for outbound ports; assert outcomes and port calls.
- Outbound adapters: shared contract tests per port, run against each implementation; integration tests against real infra (DB, queue) for queries, serialization, timeouts.
- Inbound adapters: protocol mapping and error mapping.
- End-to-end: critical journeys only.

## Review checklist

- [ ] Domain and use cases import only internal types and ports
- [ ] Every external dependency sits behind an outbound port
- [ ] Validation at the inbound boundary plus use-case invariants
- [ ] Infrastructure errors translated to application errors at the adapter
- [ ] Composition root explicit and auditable
- [ ] Use cases testable with simple fakes

_Source: adapted from ECC `skills/hexagonal-architecture` (MIT); see NOTICE.md._
