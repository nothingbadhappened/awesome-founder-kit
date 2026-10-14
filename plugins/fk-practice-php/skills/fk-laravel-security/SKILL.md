---
name: fk-laravel-security
description: Use when reviewing or configuring Laravel security - production config, Sanctum/Passport, passwords and sessions, policies, mass assignment, raw SQL, CSRF, Blade XSS, uploads, rate limits.
---

# Laravel security checklist

Framework-specific complement to `fk-security-checklist`. Examples of config and code for each item: [reference.md](reference.md) (read it at the step you are fixing).

## 1. Production configuration

- [ ] `APP_DEBUG=false`, `APP_ENV=production`, `APP_KEY` set (boot fails if missing).
- [ ] HTTPS enforced (proxy or `URL::forceScheme('https')`); `trusted_proxies` limited to real proxy ranges, never `*`.
- [ ] Session cookie `secure`, `http_only`, `same_site=lax` (or strict); session driver database/redis.
- [ ] Secrets only in environment/secret manager; `.env` git-ignored, `.env.example` holds placeholders; required secrets validated at boot.

## 2. Authentication

- [ ] Sanctum for first-party SPA/mobile tokens (expiration set, abilities per token, `abilities:`/`ability:` middleware); Passport only when OAuth2 for third parties is needed.
- [ ] Passwords: `Password::min(12)` (or the project's rule) with `uncompromised()`; hashing via Laravel's hasher (bcrypt rounds >= 12 or Argon2id); `'password' => 'hashed'` cast.
- [ ] `session()->regenerate()` on login; `invalidate()` + `regenerateToken()` on logout.
- [ ] Login, registration, reset and 2FA endpoints throttled (`throttle:auth` limiter keyed by IP and email).

## 3. Authorization

- [ ] Policies registered for every model exposed to users; controllers call `$this->authorize(...)`/`Gate::authorize(...)`, routes use `can:` middleware, Blade uses `@can`.
- [ ] Form requests `authorize()` returns a real policy check, never a blanket `true` for protected actions.
- [ ] `Gate::before` super-admin overrides are deliberate and audited.
- [ ] Scoped route bindings for nested resources; tenant scoping on multi-tenant models.

## 4. Eloquent and SQL

- [ ] `$fillable` allow-lists; no `$guarded = []`; role/admin flags never fillable.
- [ ] Create/update from `$request->validated()` or `$request->safe()->only([...])`, never `$request->all()`.
- [ ] Raw queries use bindings: `whereRaw('email = ?', [$email])`, `DB::select('... = ?', [$v])`; no interpolated strings in `DB::statement`, `whereRaw`, `orderByRaw`, `groupByRaw`; sort/column names from user input checked against an allow-list.
- [ ] `$hidden` covers passwords, tokens, 2FA secrets; `encrypted` casts for sensitive columns.

## 5. CSRF and CORS

- [ ] `@csrf` in every state-changing form; JS sends `X-CSRF-TOKEN`/`X-XSRF-TOKEN`.
- [ ] CSRF exclusions only for signed webhooks (e.g. payment provider routes verifying signatures); never blanket `api/*` when Sanctum stateful auth is used.
- [ ] `config/cors.php` origins from an allow-list env var; `supports_credentials` only with explicit origins.

## 6. XSS and headers

- [ ] Blade `{{ }}` for user data; `{!! !!}` only for trusted or purified HTML (HTMLPurifier allow-list).
- [ ] Data into scripts via `@js(...)`/`Js::from`, never `{{ json_encode() }}` inside `<script>`.
- [ ] Security headers middleware: CSP (no `unsafe-inline` scripts), `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, HSTS.

## 7. Uploads

- [ ] Rules: `file`/`image`, `mimes:` and `extensions:` allow-lists, `max:` size, `dimensions:` for images.
- [ ] Sensitive files on a private disk; served via authorized download or `Storage::temporaryUrl` after a policy check; server-side encryption on cloud disks.

## 8. APIs and queues

- [ ] `RateLimiter::for('api')` keyed by user or IP; stricter named limiters for auth and uploads; 429 responses.
- [ ] Jobs carrying sensitive data implement `ShouldBeEncrypted`; jobs have `retryUntil`/`tries`, rate-limit middleware where external quotas apply.

## 9. Dependencies and monitoring

- [ ] `composer audit` in CI; `composer.lock` committed; `composer update` only deliberately, never in deploy.
- [ ] Security events (failed logins, role changes, permission denials) logged to a monitored channel without passwords or tokens.

_Source: adapted from ECC `skills/laravel-security` (MIT); see NOTICE.md._
