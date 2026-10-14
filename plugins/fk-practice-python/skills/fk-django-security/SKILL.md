---
name: fk-django-security
description: Use when reviewing or configuring Django security - production settings, auth and passwords, permissions, ORM/raw SQL, template escaping, CSRF, uploads, DRF auth and throttling, headers, secrets.
---

# Django security checklist

Framework-specific complement to `fk-security-checklist`. Run `python manage.py check --deploy` with production settings; it must be clean or each warning justified.

## 1. Production settings

- [ ] `DEBUG = False`; `ALLOWED_HOSTS` from env; `SECRET_KEY` from env and startup fails if missing.
- [ ] `SECURE_SSL_REDIRECT = True` (or enforced at the proxy, with `SECURE_PROXY_SSL_HEADER` set correctly).
- [ ] `SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = True`; `SESSION_COOKIE_HTTPONLY = True`; `SameSite` `Lax` (or `Strict` where flows allow).
- [ ] HSTS: `SECURE_HSTS_SECONDS` (start small, then a year), `SECURE_HSTS_INCLUDE_SUBDOMAINS`; preload only when every subdomain is HTTPS.
- [ ] `SECURE_CONTENT_TYPE_NOSNIFF = True`, `X_FRAME_OPTIONS = 'DENY'`, `SECURE_REFERRER_POLICY` set.
- [ ] Admin at a non-default path, behind strong auth (2FA if available).

## 2. Authentication

- [ ] Custom user model; email uniqueness enforced in the database.
- [ ] `AUTH_PASSWORD_VALIDATORS` all enabled with a minimum length (12+ unless the project decides otherwise).
- [ ] `PASSWORD_HASHERS` starts with Argon2 (`argon2-cffi` installed); old hashes upgrade on login.
- [ ] Login, password reset and signup rate-limited (django-axes or throttles); reset tokens single-use and expiring.
- [ ] Session lifetime set (`SESSION_COOKIE_AGE`); sessions rotated on login (Django default) and cleared on logout.

## 3. Authorization

- [ ] Every view declares access: `LoginRequiredMixin`/`@login_required`, `PermissionRequiredMixin` with `raise_exception = True`, or DRF `permission_classes`.
- [ ] Object-level checks: querysets scoped to the user (`Post.objects.filter(author=request.user)`) or DRF `has_object_permission` (`IsOwnerOrReadOnly`).
- [ ] DRF default permission `IsAuthenticated`; public endpoints opt out explicitly with `AllowAny`.
- [ ] Ownership fields set from `request.user` in `perform_create`, never accepted from the client; serializers do not expose `is_staff`, `is_superuser`, role fields as writable.

## 4. Injection

- [ ] ORM, `Q` objects and parameterized `raw('... WHERE email = %s', [email])` / `cursor.execute(sql, params)` only; no f-strings or `%` formatting into SQL, `extra()`, or `RawSQL` with user input.
- [ ] No `subprocess` with `shell=True` on user input; no `eval`/`pickle` of untrusted data.

## 5. XSS and templates

- [ ] Auto-escaping never disabled; `|safe` and `mark_safe` never applied to user input. Build HTML with `format_html`.
- [ ] Data passed to JavaScript via `json_script`, not string interpolation into `<script>`.
- [ ] User HTML (rich text) sanitized with a maintained sanitizer (e.g. `nh3`) before storage or rendering.
- [ ] CSP via `django-csp` or middleware; avoid `'unsafe-inline'` scripts.

## 6. CSRF

- [ ] `CsrfViewMiddleware` enabled; `{% csrf_token %}` in every POST form; AJAX sends `X-CSRFToken`.
- [ ] `CSRF_TRUSTED_ORIGINS` lists only real HTTPS origins.
- [ ] `@csrf_exempt` only for webhooks that verify the sender's signature.

## 7. File uploads

- [ ] Size limits (`DATA_UPLOAD_MAX_MEMORY_SIZE`, `FILE_UPLOAD_MAX_MEMORY_SIZE`, validator on the field).
- [ ] Type checked by content (python-magic or `filetype`) and cross-checked with the extension against an allow-list.
- [ ] Uploads stored outside code paths with generated names, served from object storage or a separate domain, never executed.

## 8. APIs

- [ ] DRF throttling: `AnonRateThrottle`, `UserRateThrottle`, scoped throttles for auth and uploads, backed by a shared cache.
- [ ] Token/JWT lifetimes short with refresh; tokens revocable; CORS (`django-cors-headers`) restricted to known origins.
- [ ] Errors never return tracebacks (DEBUG off, custom exception handler).

## 9. Secrets, logging, dependencies

- [ ] Secrets via env/secret manager; local env files git-ignored.
- [ ] `django.security` and `django.request` loggers routed to monitored handlers; no passwords/tokens/PII in logs.
- [ ] Django and dependencies on supported versions; `pip-audit` in CI; security releases applied promptly.

_Source: adapted from ECC `skills/django-security` (MIT); see NOTICE.md._
