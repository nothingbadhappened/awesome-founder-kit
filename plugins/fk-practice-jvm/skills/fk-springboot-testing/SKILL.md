---
name: fk-springboot-testing
description: Use when writing or fixing Spring Boot tests - JUnit 5 + Mockito unit tests, @WebMvcTest slices, @DataJpaTest with Testcontainers, full @SpringBootTest, security tests and JaCoCo coverage.
---

# Spring Boot testing

For test-first work OMC's `tdd` workflow drives the cycle; this skill picks the right Spring test type. Coverage thresholds are the project's decision (JaCoCo can enforce them once agreed).

## Choose the test type

| Testing | Use | Notes |
|---|---|---|
| Service/domain logic | plain JUnit 5 + Mockito (`@ExtendWith(MockitoExtension.class)`, `@Mock`, `@InjectMocks`) | no Spring context, fastest |
| Controller mapping, validation, status codes, JSON | `@WebMvcTest(Controller.class)` + `MockMvc` + `@MockitoBean` (or `@MockBean` on older Boot) for services | add `spring-security-test` for auth |
| Repositories, queries, mappings | `@DataJpaTest` + `@AutoConfigureTestDatabase(replace = NONE)` + Testcontainers | real Postgres/MySQL, not H2, when queries use engine features |
| Wiring, filters, end-to-end request | `@SpringBootTest` + `@AutoConfigureMockMvc` (or `webEnvironment = RANDOM_PORT`) + `@ActiveProfiles("test")` | few, for critical flows |

## Writing tests

1. Arrange / act / assert; one behaviour per test; names state the behaviour.
2. AssertJ for assertions (`assertThat(...)`, `assertThatThrownBy(...).isInstanceOf(...)`); `jsonPath("$.content").isArray()` for JSON.
3. `@ParameterizedTest` with `@CsvSource`/`@MethodSource` for variants (validation cases, edge values).
4. Stub explicitly (`when(...).thenReturn(...)`), verify meaningful interactions only; avoid partial mocks and spies of the class under test.
5. Test data builders (`MarketBuilder.aMarket().withName("x").build()`) instead of large constructors.

## Controllers

- Cover: 2xx happy path, 400/422 for each invalid field, 404, and the error body shape from the exception handler.
- Security: `@WithMockUser(roles = "ADMIN")`, `with(jwt())`, `with(csrf())`; assert 401 unauthenticated and 403 wrong role/owner.

## Persistence with Testcontainers

- `@Testcontainers` + `@Container static PostgreSQLContainer<?>` (pinned image tag) and `@ServiceConnection` (Boot 3.1+) or `@DynamicPropertySource` for the JDBC URL.
- Run Flyway/Liquibase migrations in tests so schema drift is caught.
- Reuse containers across tests (singleton container pattern) to keep the suite fast.

## Messaging and external HTTP

- External HTTP: WireMock or `MockRestServiceServer`; cover timeouts and 5xx.
- Kafka/RabbitMQ: Testcontainers brokers or the framework's test binders; assert idempotent handling of duplicates.

## Determinism

- Inject a `Clock` instead of calling `Instant.now()`; fixed seeds for randomness.
- No `Thread.sleep`; use Awaitility for async assertions.
- Keep the number of distinct Spring contexts small (context caching): avoid unnecessary `@MockitoBean` variations and `@DirtiesContext`.

## Coverage

- JaCoCo `prepare-agent` + `report` (Maven) or `jacocoTestReport` (Gradle); add a `check`/`verify` rule with the project's agreed minimum, excluding generated code and config classes.

## Commands

- Maven: `mvn test`, `mvn verify` (integration + coverage), `mvn -Dtest=MarketServiceTest test`.
- Gradle: `./gradlew test`, `./gradlew test --tests "*MarketServiceTest"`, `./gradlew jacocoTestReport`.

_Source: adapted from ECC `skills/springboot-tdd` (MIT); see NOTICE.md._
