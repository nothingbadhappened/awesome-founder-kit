---
name: fk-django-patterns
description: Use when building or reviewing Django or Django REST Framework code - project layout, settings, models and querysets, serializers, viewsets, service layer, caching, signals, N+1 and bulk operations.
---

# Django patterns

Project ADRs win (layout, API style, async use). Security: `fk-django-security`; tests: `fk-django-testing`; migrations: `fk-database-migrations`.

## Layout and settings

- `config/settings/{base,development,test,production}.py`; `base` reads everything secret or environment-specific from env vars (django-environ / os.environ) and defaults to `DEBUG = False`.
- Apps under `apps/<domain>/` with `models.py`, `services.py`, `selectors.py` (optional), `serializers.py`, `views.py`, `urls.py`, `permissions.py`, `tests/`.
- Custom user model (`AUTH_USER_MODEL`) from day one, even if it adds nothing yet.
- Log to stdout in containers; structured logs in production.

## Models

- Fields: `DecimalField` for money, `PositiveIntegerField` for counts, `null=True` only for non-string fields (strings use `blank=True` + `""`), `related_name` on every FK/M2M.
- `on_delete` chosen deliberately (`PROTECT` for financial/history records, `CASCADE` for owned children).
- `Meta.indexes` for fields used in filters/ordering (composite in query order), `Meta.constraints` (`CheckConstraint`, `UniqueConstraint`) for invariants the database can enforce.
- `created_at = DateTimeField(auto_now_add=True)`, `updated_at = DateTimeField(auto_now=True)`, a useful `__str__`.
- Keep `save()` overrides small (slug defaults); business workflows belong in services.

## QuerySets and managers

- Custom `QuerySet` with chainable intent methods (`active()`, `in_stock()`, `with_category()`), exposed via `objects = ProductQuerySet.as_manager()`.
- **N+1**: `select_related` for FK/one-to-one, `prefetch_related` (with `Prefetch` objects for filtered sets) for reverse FK/M2M; check with django-debug-toolbar or `assertNumQueries`.
- `only()`/`values()` for hot read paths; `exists()` instead of `count()` for presence; `iterator()` for large scans.
- Bulk: `bulk_create`, `bulk_update(objs, fields, batch_size=...)`, `queryset.update(...)` (note: bypasses `save()` and signals).
- Race-free updates: `F()` expressions (`stock=F('stock') - 1`), `select_for_update()` inside `transaction.atomic()`.

## Service layer

- Services (functions or classes in `services.py`) own multi-model workflows and run them in `transaction.atomic()`.
- External calls (payments, email) happen outside the transaction or via `transaction.on_commit(...)` so they only fire after a successful commit.
- Views and serializers call services; they do not contain workflows.

## DRF

- Separate serializers for read and write (`get_serializer_class()` by action); `read_only_fields`; `write_only` for passwords; field-level `validate_<field>` and object-level `validate()`.
- ViewSets: queryset with `select_related`/`prefetch_related`, `permission_classes` explicit on every view, filtering via django-filter, `SearchFilter`, `OrderingFilter` with an allow-listed `ordering_fields` and a default `ordering`.
- Global defaults in `REST_FRAMEWORK`: authentication classes, `IsAuthenticated` as the default permission, pagination class + `PAGE_SIZE`, throttling.
- `perform_create` sets ownership from `request.user`, never from request data.
- Custom endpoints via `@action(detail=..., methods=[...])` that delegate to services.

## Caching

- Low-level `cache.get`/`cache.set(key, value, timeout)` around expensive querysets (evaluate with `list(...)` before caching); invalidate on writes.
- `cache_page` only for anonymous, non-personalized views; template fragment caching for expensive partials.
- Redis-backed cache in production; see `fk-redis-patterns`.

## Signals and middleware

- Prefer explicit service calls over signals; use signals for decoupled side effects (e.g. creating a profile), registered in `AppConfig.ready()`.
- Middleware for cross-cutting concerns only (request ids, timing logs); avoid a DB write per request.

## Review checklist

- [ ] Settings split; secrets from env; `DEBUG` false by default
- [ ] Indexes and constraints match queries and invariants
- [ ] No N+1 (`select_related`/`prefetch_related`), bulk ops for batches
- [ ] Workflows in services inside `transaction.atomic`, side effects `on_commit`
- [ ] DRF permissions explicit, pagination on, ownership from `request.user`

_Source: adapted from ECC `skills/django-patterns` (MIT); see NOTICE.md._
