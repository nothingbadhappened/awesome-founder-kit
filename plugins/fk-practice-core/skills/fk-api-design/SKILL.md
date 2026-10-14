---
name: fk-api-design
description: Use when designing or reviewing HTTP/REST endpoints - resource names, methods, status codes, error envelope, pagination, filtering, auth checks, rate limits, versioning.
---

# API design (REST)

Project ADRs and `docs/standards/` win (envelope shape, casing, versioning). Apply these defaults where they are silent, and stay consistent with existing endpoints.

## 1. Resources

- Nouns, plural, lowercase, kebab-case: `/api/v1/team-members`, `/api/v1/users/:id/orders`.
- No verbs in paths except non-CRUD actions: `POST /orders/:id/cancel`, `POST /auth/login`.
- Filters go in the query string, ownership in nesting.

## 2. Methods and status codes

| Method | Use | Idempotent |
|---|---|---|
| GET | read | yes (and safe) |
| POST | create, trigger action | no |
| PUT | full replace | yes |
| PATCH | partial update | not by default |
| DELETE | remove | yes |

- 200 read/update with body; 201 create + `Location` header; 204 no body.
- 400 malformed / validation; 401 not authenticated; 403 not allowed; 404 missing; 409 conflict; 422 semantically invalid; 429 rate limited (+ `Retry-After`).
- 500 unexpected (never expose details); 502 upstream failed; 503 overloaded (+ `Retry-After`).
- Never return 200 with `success: false`.

## 3. Response shape

- Success: `{ "data": ... }`; collections add `meta` (pagination) and optionally `links`.
- Error: `{ "error": { "code": "validation_error", "message": "...", "details": [{ "field", "message", "code" }] } }`.
- Internal APIs may return the bare resource if the project decided so; be consistent per API.
- Field casing follows the existing API (camelCase or snake_case), never mixed.

## 4. Pagination, filtering, sorting

- Offset (`?page=2&per_page=20`): small datasets, admin screens, "jump to page".
- Cursor (`?cursor=...&limit=20`, fetch limit+1 to compute `has_next`): feeds, large or fast-changing tables, public APIs.
- Filters: `?status=active`, ranges `?price[gte]=10&price[lte]=100`, lists `?category=a,b`.
- Sort: `?sort=-created_at,price` (`-` = descending). Search: `?q=...`. Sparse fields: `?fields=id,name`.
- Every list endpoint is paginated with a server-side max page size.

## 5. Auth and authorization

- Bearer token or session cookie for users; API keys only server-to-server.
- Check ownership/role on every resource access, after loading the resource: missing -> 404, not yours -> 403 (or 404 to avoid leaking existence, if the project prefers).
- Public endpoints are explicitly marked as such.

## 6. Rate limiting

- Return `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; 429 with `Retry-After` when exceeded.
- Tighter limits on expensive or abuse-prone endpoints (search, auth, uploads). Limits per IP for anonymous, per user/key when authenticated.

## 7. Versioning

- Start at `/api/v1/`; add a version only for breaking changes (removing/renaming fields, type changes, URL or auth changes).
- Additive changes (new fields, optional params, new endpoints) need no new version.
- Keep at most current + previous; announce deprecation, send `Sunset`, return 410 after it. Record the policy as an ADR.

## 8. Checklist before shipping an endpoint

- [ ] Name, method and status codes follow the rules above
- [ ] Input validated with a schema at the boundary (zod, pydantic, Bean Validation, ...)
- [ ] Error envelope matches the project format; no stack traces or SQL in responses
- [ ] List endpoints paginated
- [ ] Authentication required or explicitly public; authorization checked per resource
- [ ] Rate limit configured
- [ ] Naming consistent with existing endpoints
- [ ] OpenAPI/contract updated, with a contract or integration test

_Source: adapted from ECC `skills/api-design` (MIT); see NOTICE.md._
