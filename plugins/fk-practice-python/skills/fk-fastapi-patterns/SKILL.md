---
name: fk-fastapi-patterns
description: Use when building or reviewing FastAPI apps - layout, settings, Pydantic v2 schemas, dependency injection, async database access, auth vs authorization, service layer, errors and httpx tests.
---

# FastAPI patterns

Project ADRs win (ORM, auth provider, sync vs async). API contract rules: `fk-api-design`; tests: `fk-python-testing`.

## Layout

```text
app/main.py          app factory, lifespan, middleware, router registration
app/config.py        pydantic-settings Settings
app/dependencies.py  db session, current user, typed Annotated aliases
app/database.py      engine + sessionmaker
app/routers/         thin endpoint modules
app/schemas/         Pydantic request/response models
app/models/          ORM models
app/services/        business logic and transactions
tests/
```

## Steps for a new endpoint

1. **Schemas**: separate `XCreate`, `XUpdate` (all optional, applied with `model_dump(exclude_unset=True)`), `XResponse` (`model_config = {"from_attributes": True}`). Validate with `Field(...)` constraints and `model_validator(mode="after")` for cross-field rules.
2. **Dependencies**: `get_db()` yields an `AsyncSession` and rolls back on exceptions; `get_current_user` decodes the token defensively (missing/invalid `sub` -> 401 with `WWW-Authenticate: Bearer`); `get_current_active_user` -> 403 when inactive. Publish aliases: `DbDep = Annotated[AsyncSession, Depends(get_db)]`, `ActiveUserDep = ...`.
3. **Service**: a class or functions taking the session; commits inside the service, catches `IntegrityError` -> rollback -> domain error (`DuplicateUserError`). Rely on database unique constraints, not check-then-insert.
4. **Router**: thin; declares `response_model` and `status_code`; validates query params with `Annotated[int, Query(ge=0, le=100)]`; maps domain errors to `HTTPException`; checks authorization (401 = not authenticated, 403 = not allowed) separately from authentication.
5. **Pagination**: bounded `limit`, deterministic `order_by` (e.g. by id) for offset pagination, or keyset for large tables.
6. **Tests** (below).

## App setup

- App factory `create_app()`; `lifespan` async context manager opens/closes pools (`await engine.dispose()`). Schema changes go through Alembic migrations, not `create_all` at startup (acceptable only for throwaway demos).
- CORS from settings with explicit origins, methods and headers; never `*` with credentials.
- Settings: `class Settings(BaseSettings)` with required secrets (no defaults for `secret_key`, `database_url`); load once, inject where needed.
- Register exception handlers for domain errors -> consistent error envelope (`fk-error-handling`).

## Async rules

- Inside `async def` use only async drivers (SQLAlchemy async + asyncpg, httpx.AsyncClient). A sync DB call in an async route blocks the event loop; either make the route `def` (runs in a threadpool) or use async I/O.
- Reuse one HTTP client per app (created in lifespan) with timeouts.
- Background work beyond trivial `BackgroundTasks` goes to a real queue.

## Security

- Passwords hashed with a slow algorithm (argon2/bcrypt via passlib or pwdlib); JWTs signed with a key from settings, short expiry, `exp` checked, algorithm pinned on decode.
- Always declare `response_model` so internal fields (password hashes) never leak.
- Rate limit auth endpoints (gateway or a shared-store limiter).

## Testing

- `httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test")` with `pytest-asyncio` fixtures.
- Override dependencies: `app.dependency_overrides[get_db] = override_get_db` yielding a test session; clear overrides after each test.
- Use the production database engine for integration tests when queries depend on it (SQLite in-memory only for simple cases).
- Fixtures chain: `registered_user` -> `auth_token` -> `auth_client` (Authorization header).
- Cover: 201 create, 422 validation, 401 without token, 403 other user's resource, 404 missing, duplicate -> conflict error, pagination bounds.

## Anti-patterns

- Business logic and commits inside route functions.
- Sync ORM sessions in async routes.
- Returning ORM objects without `response_model`.
- Unbounded `limit`, unordered offset pagination.
- `create_all` in production startup.

_Source: adapted from ECC `skills/fastapi-patterns` (MIT); see NOTICE.md._
