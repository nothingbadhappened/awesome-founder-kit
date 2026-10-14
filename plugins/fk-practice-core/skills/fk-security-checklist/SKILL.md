---
name: fk-security-checklist
description: Use when adding auth, handling user input or uploads, touching secrets, payments or personal data, creating endpoints, or deploying to cloud/CI - application and infrastructure security checklist.
---

# Security checklist

A checklist for builders and OMC's code-reviewer/security-reviewer. The project's threat model (`docs/standards/security*`) wins; framework-specific checklists live in the stack packs (Django, Laravel, Spring, ...). For cloud, CI/CD and infrastructure, read [reference.md](reference.md) at step 9.

## Steps

1. **Secrets**
   - [ ] No keys, tokens or passwords in code, tests, logs or commits; config comes from the environment or a secrets manager.
   - [ ] Startup fails fast if a required secret is missing.
   - [ ] Local env files are git-ignored; git history checked when a secret may have leaked (rotate it, do not just delete).
2. **Input validation**
   - [ ] Every external input validated with a schema at the boundary (allow-list, types, lengths, ranges).
   - [ ] Uploads: size limit, MIME type and extension allow-list, content sniffing for images, stored outside the web root with generated names.
   - [ ] Validation errors do not echo sensitive data.
3. **Injection**
   - [ ] All SQL is parameterized (driver placeholders, ORM, query builder); no string concatenation or interpolation of input into SQL, shell commands, LDAP, paths or templates.
   - [ ] Shell calls use argument arrays, never a shell string built from input.
   - [ ] File paths from input are normalized and confined to an allowed directory.
4. **Authentication and sessions**
   - [ ] Browser sessions in `HttpOnly; Secure; SameSite` cookies, not localStorage.
   - [ ] Passwords hashed with a slow algorithm (argon2id, bcrypt, scrypt); login and reset endpoints rate-limited.
   - [ ] Tokens expire; refresh and logout invalidate server-side state.
5. **Authorization**
   - [ ] Every sensitive operation checks the caller's role/ownership on the server, after loading the resource.
   - [ ] Row-level security or tenant filters on multi-tenant data (e.g. Postgres RLS, Supabase policies).
   - [ ] Deny by default; admin routes separate and audited.
6. **XSS and browser**
   - [ ] User HTML sanitized with a maintained sanitizer before rendering raw; frameworks' auto-escaping not bypassed.
   - [ ] Content-Security-Policy starts strict (`default-src 'self'; object-src 'none'; frame-ancestors 'none'`); `'unsafe-inline'`/`'unsafe-eval'` only as documented, temporary debt.
   - [ ] Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS in production.
   - [ ] CSRF protection on state-changing cookie-authenticated requests (tokens or SameSite + origin check).
   - [ ] CORS limited to known origins; never `*` with credentials.
7. **Abuse limits**
   - [ ] Rate limits on all public endpoints, stricter on auth, search, uploads and other expensive calls; per IP and per user.
   - [ ] Request body size limits and timeouts.
8. **Sensitive data**
   - [ ] Logs exclude passwords, tokens, full card numbers and personal data beyond what is needed (log ids, last4).
   - [ ] User-facing errors generic; details only in server logs; no stack traces in responses.
   - [ ] Personal data encrypted in transit (TLS) and at rest where the platform allows; retention defined.
   - [ ] Payments go through the provider's hosted fields/SDK; webhooks verify signatures.
   - [ ] Wallet/transaction code verifies signatures, recipient, amount and balance; never signs blindly.
9. **Infrastructure and CI** - read [reference.md](reference.md): least-privilege IAM, no public databases, OIDC in CI, logging, backups.
10. **Dependencies**
    - [ ] Lock files committed; CI installs from the lock file (`npm ci`, `pip install --require-hashes`, ...).
    - [ ] Dependency audit runs in CI at the project's severity threshold; new dependencies pinned and reviewed.
11. **Tests that prove it**
    - [ ] Protected route without auth -> 401; wrong role -> 403; invalid input -> 400/422; burst over limit -> 429.

## Before any production deploy

Secrets out of code; inputs validated; queries parameterized; output escaped/sanitized; CSRF and CORS configured; auth and authorization checked server-side; rate limits on; HTTPS + security headers; errors and logs free of sensitive data; dependencies audited; RLS/tenant isolation on; uploads restricted; infrastructure items in reference.md checked.

_Source: adapted from ECC `skills/security-review` and its `cloud-infrastructure-security.md` (MIT); renamed to avoid the Claude Code built-in `/security-review`; see NOTICE.md._
