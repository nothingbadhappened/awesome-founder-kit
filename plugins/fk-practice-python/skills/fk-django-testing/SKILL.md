---
name: fk-django-testing
description: Use when writing or fixing Django or DRF tests - pytest-django setup, test settings, factory_boy, model/view/serializer/API tests, permissions, mocking external services, email and query counts.
---

# Django testing (pytest-django)

Generic pytest mechanics: `fk-python-testing`. For test-first work OMC's `tdd` workflow drives the cycle. The project's coverage policy wins.

## Setup

- `pyproject.toml`/`pytest.ini`: `DJANGO_SETTINGS_MODULE = config.settings.test`, `--reuse-db`, `--strict-markers`.
- `config/settings/test.py`: fast hasher (`MD5PasswordHasher`, tests only), locmem email backend, Celery eager (`CELERY_TASK_ALWAYS_EAGER = True`, `CELERY_TASK_EAGER_PROPAGATES = True`), local-memory cache.
- Database: use the production engine (Postgres via a CI service or testcontainers) when code relies on engine features; SQLite in-memory only if the project accepts the gap. Keep migrations on in CI at least once (`--nomigrations` only for fast local loops) so broken migrations are caught.
- `tests/conftest.py`: `user`, `admin_user`, `api_client` (`rest_framework.test.APIClient`), `authenticated_api_client` (`force_authenticate`), `authenticated_client` (`client.force_login`).

## Factories (factory_boy)

- One `DjangoModelFactory` per model in `tests/factories.py`: `Sequence` for unique fields, `Faker` for realistic values, `SubFactory` for FKs, `PostGenerationMethodCall('set_password', ...)` for users, `post_generation` hooks for M2M.
- Override only what the test cares about: `ProductFactory(price=100)`; batches with `create_batch(n)`; `build()` when the DB is not needed.

## What to test

| Layer | Cover |
|---|---|
| Models | constraints (`full_clean()` raises), custom methods, queryset methods, `__str__` |
| Services | workflows, transactions rolled back on failure, side effects via `on_commit` (`django_capture_on_commit_callbacks`) |
| Serializers | valid data saves; each invalid field yields an error keyed by field; read-only fields ignored |
| Views/API | status codes, response shape, pagination, filters/search/order |
| Permissions | anonymous -> 401/redirect, other user -> 403/404, owner -> allowed, admin paths |
| Email | `mail.outbox` length, recipients, subject |

## Patterns

- Mark DB tests (`db` fixture or `@pytest.mark.django_db`); `transaction=True` only when testing transaction behaviour.
- URLs via `reverse('api:product-list')`, not hard-coded paths.
- Authorization tests for every write endpoint: unauthenticated, wrong owner, owner.
- External services (payments, HTTP APIs) mocked where your code calls them (`patch('apps.payments.services.stripe')`) or with `responses`/`respx`; assert both success and failure paths.
- Settings changes per test with the `settings` fixture or `override_settings`.
- Query-count guards on hot endpoints: `django_assert_num_queries` / `assertNumQueries` to lock in N+1 fixes.
- Time with `freezegun` or an injected clock.

## Integration flows

A few end-to-end tests through the test client for critical journeys (sign up -> log in -> purchase), mocking only third-party boundaries. Browser-level flows belong to Playwright (`fk-e2e-testing` in the web pack).

## Anti-patterns

- Testing Django or library internals; testing private helpers instead of public behaviour.
- Tests depending on order or shared rows; using a production database.
- Over-mocking your own code (ORM, services) in API tests.
- Snapshotting entire responses where a few field assertions say more.

## Commands

`pytest`, `pytest apps/orders -k checkout -x`, `pytest --cov=apps --cov-report=term-missing`, `pytest --create-db` after migration changes.

_Source: adapted from ECC `skills/django-tdd` (MIT); see NOTICE.md._
