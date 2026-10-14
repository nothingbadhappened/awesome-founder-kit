---
name: fk-python-testing
description: Use when writing or fixing pytest tests - structure, fixtures and scopes, parametrization, markers, mocking with autospec, async tests, temp files, database isolation and coverage.
---

# Python testing (pytest)

The project's test layout, markers and coverage thresholds win. For test-first work, OMC's `tdd` workflow drives the cycle; this skill covers the pytest mechanics.

## Layout and config

- `tests/unit/`, `tests/integration/`, `tests/e2e/`; shared fixtures in `tests/conftest.py` (nested `conftest.py` per area as needed).
- Config in `pyproject.toml` `[tool.pytest.ini_options]`: `testpaths`, `--strict-markers`, registered `markers` (`slow`, `integration`, ...). Do not blanket-disable warnings; filter specific ones.

## Writing tests

1. One behaviour per test; name it after the behaviour: `test_login_with_invalid_password_fails`.
2. Arrange / act / assert with plain `assert` (pytest rewrites it with good diffs).
3. Exceptions: `with pytest.raises(ValueError, match="invalid input") as exc_info:`; then assert on `exc_info.value` attributes. Never `try/except` in a test.
4. Edge cases: empty, `None`, boundaries, unicode, large inputs, error paths.
5. Tables of cases: `@pytest.mark.parametrize("raw,expected", [...], ids=[...])` with readable ids.

## Fixtures

- Prefer fixtures over setup code in tests; `yield` fixtures for teardown.
- Scope deliberately: `function` (default, isolated), `module`/`session` only for expensive, read-only resources. Shared mutable state across tests causes order-dependent failures.
- `autouse=True` only for true global resets (config, env).
- Built-ins: `tmp_path` for files, `monkeypatch` for env vars and attributes, `caplog` for logs, `capsys` for output.
- Factory fixtures (or factory_boy) to build domain objects with sensible defaults.

## Mocking

- Mock at the boundary you do not own (HTTP, clock, queues, third-party SDKs), not your own internals.
- Patch where the name is looked up: `patch("myapp.service.requests.get")`, not `requests.get`.
- `autospec=True` (or `create_autospec`) so mocks fail on wrong signatures.
- `side_effect` for errors and sequences; `assert_called_once_with(...)`, `assert_awaited_once()` for async.
- HTTP: prefer `respx`/`responses`/`pytest-httpserver` over hand-built mocks; time: `freezegun` or an injected clock.

## Async

- `pytest-asyncio` (or anyio plugin): mark tests `@pytest.mark.asyncio` (or set auto mode); async fixtures with `yield`.
- Mock coroutines with `AsyncMock`.

## Databases

- Wrap each test in a transaction/savepoint that is rolled back, or use the framework's test DB support (Django `TestCase`, pytest-django `db` fixture).
- Integration tests against the real engine (testcontainers or a CI service), not SQLite pretending to be Postgres, when queries use engine features.

## Selection and speed

- `pytest -m "not slow"`, `-k <expr>`, `-x`, `--maxfail=3`, `--lf`, `-n auto` (pytest-xdist) when tests are independent.
- Keep unit tests fast; mark slow and integration tests so CI can split them.

## Coverage

`pytest --cov=<package> --cov-report=term-missing`; enforce the project's threshold with `--cov-fail-under` only if the project set one. Cover critical paths and error handling first; do not write assertion-free tests to raise the number.

## Anti-patterns

- Testing implementation details or third-party libraries.
- Over-specified mocks that break on harmless refactors.
- `print` debugging left in tests; `skip`/`xfail` without a reason and a tracking issue.
- Network calls to real external services in unit tests.

_Source: adapted from ECC `skills/python-testing` (MIT); see NOTICE.md._
