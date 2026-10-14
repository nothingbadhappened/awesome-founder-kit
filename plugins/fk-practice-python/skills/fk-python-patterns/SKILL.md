---
name: fk-python-patterns
description: Use when writing or reviewing Python code - idioms, type hints, exceptions, context managers, dataclasses, concurrency choice, packaging layout, tooling and common anti-patterns.
---

# Python patterns

The project's `pyproject.toml`, linters and standards win (Python version, formatter, type-checker strictness).

## Style and structure

- PEP 8 via the project's formatter/linter (ruff format/black, ruff, isort-compatible import order: stdlib, third-party, local). Do not reformat files you did not otherwise change.
- `src/<package>/` layout with `tests/` beside it; `pyproject.toml` as the single config file.
- Explicit imports only (no `from x import *`); `__all__` for public package exports.
- Readable over clever: expand comprehensions with more than one condition or nested loops into a loop or generator function.

## Typing

- Annotate every public function signature; built-in generics (`list[str]`, `dict[str, int]`, `X | None`) on 3.9+/3.10+.
- `Protocol` for duck-typed interfaces; `TypeVar`/PEP 695 generics for generic helpers; `TypeAlias` for complex unions.
- Run the project's type checker (mypy/pyright) in CI at the configured strictness.

## Errors

- Catch specific exceptions; never bare `except:` or `except Exception: pass`.
- Re-raise with context: `raise ConfigError(f"invalid config: {path}") from e`.
- One base `AppError` per package with specific subclasses; see `fk-error-handling` for boundaries.
- EAFP (`try`/`except KeyError`) is idiomatic when the failure is rare; use `.get()` or explicit checks when absence is normal.

## Resources and data

- Always `with` for files, locks, connections, transactions; write `@contextmanager` helpers or `__enter__`/`__exit__` classes that never swallow exceptions.
- `@dataclass` (with `frozen=True` where values should not change, `slots=True` on 3.10+ for many instances) for plain data; `__post_init__` for invariants; pydantic models at I/O boundaries when the project uses pydantic.
- `NamedTuple` for small immutable records; `enum.Enum` for closed sets.
- `pathlib.Path` for paths; f-strings for formatting; `"".join(...)` instead of `+=` in loops.
- Generators for large or streamed data (`yield` lines instead of building lists).

## Concurrency (pick by workload)

| Workload | Use |
|---|---|
| Many I/O calls, sync codebase | `concurrent.futures.ThreadPoolExecutor` |
| Many I/O calls, async codebase | `asyncio.gather` / `TaskGroup` with an async client (httpx, aiohttp) |
| CPU-bound | `ProcessPoolExecutor` or a native library |

- Never call blocking I/O inside `async def`; offload with `asyncio.to_thread`.
- Bound concurrency (semaphore / `max_workers`) and set timeouts on every network call.

## Decorators

Use `functools.wraps`; keep decorators for cross-cutting concerns (timing, retries, caching via `functools.cache`/`lru_cache`), not business logic.

## Anti-patterns

| Bad | Good |
|---|---|
| `def f(items=[])` (mutable default) | `items: list | None = None`, then `items = items or []` |
| `type(x) == list` | `isinstance(x, list)` |
| `x == None` | `x is None` |
| bare `except:` / `pass` | specific exception, log or re-raise |
| `print` for diagnostics | `logging` (module logger: `logger = logging.getLogger(__name__)`) |
| global mutable state | pass dependencies explicitly |

## Tooling (use the project's commands)

- Format/lint: `ruff format`, `ruff check` (or black + isort + flake8/pylint).
- Types: `mypy` or `pyright`.
- Tests: `pytest` (see `fk-python-testing`).
- Security: `bandit -r src`, `pip-audit` against the lock file.
- Dependencies pinned via a lock file (uv, poetry, pip-tools); install from it in CI.

## Review checklist

- [ ] Typed public APIs; type checker passes
- [ ] Specific exceptions with `from e` chaining
- [ ] Resources managed with `with`
- [ ] No mutable defaults, `== None`, star imports, bare excepts
- [ ] Concurrency model matches the workload; timeouts set
- [ ] Linters and formatter clean

_Source: adapted from ECC `skills/python-patterns` (MIT); see NOTICE.md._
