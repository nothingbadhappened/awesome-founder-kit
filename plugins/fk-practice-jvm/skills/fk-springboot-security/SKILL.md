---
name: fk-springboot-security
description: Use when configuring or reviewing Spring Security - authentication, method-level authorization, validation, injection, password encoding, CSRF, CORS, headers, secrets, rate limits, dependencies.
---

# Spring Boot security checklist

Framework-specific complement to `fk-security-checklist`. Deny by default; configure one `SecurityFilterChain` bean per surface (API, admin, actuator).

## 1. Authentication

- [ ] Use Spring Security's OAuth2 resource server (`oauth2ResourceServer().jwt()`) or session login rather than a hand-written JWT filter; if a custom filter is unavoidable, it validates signature, issuer, audience and expiry and rejects on any failure.
- [ ] Opaque or short-lived tokens with a revocation/refresh strategy.
- [ ] Browser sessions: `HttpOnly`, `Secure`, `SameSite` cookies; session fixation protection (default) on.
- [ ] Login and reset endpoints rate-limited; lockout or backoff on repeated failures.

## 2. Authorization

- [ ] `@EnableMethodSecurity`; `@PreAuthorize("hasRole('ADMIN')")` or bean checks (`@PreAuthorize("@authz.isOwner(#id, authentication)")`) on every sensitive method.
- [ ] `authorizeHttpRequests` ends with `.anyRequest().authenticated()` (or `denyAll()`); public paths listed explicitly.
- [ ] Ownership verified for every resource id taken from the path or body.

## 3. Input and injection

- [ ] `@Valid` on all request DTOs; Bean Validation constraints on every field (`@NotBlank`, `@Email`, `@Size`, `@Min/@Max`), custom validators for domain rules.
- [ ] Spring Data derived queries or `@Query` with `:param` bindings; never concatenate input into JPQL/SQL/native queries or `EntityManager.createQuery` strings.
- [ ] HTML from users sanitized with an allow-list library (e.g. OWASP Java HTML Sanitizer) before rendering.
- [ ] No deserialization of untrusted data into polymorphic types (Jackson default typing off).

## 4. Passwords and secrets

- [ ] `PasswordEncoder` bean: `DelegatingPasswordEncoder` / Argon2 or BCrypt (cost ~12); never manual hashing.
- [ ] `application.yml` holds placeholders (`${DB_PASSWORD}`) only; secrets from env or a vault (Spring Cloud Vault, cloud secret managers); rotate credentials.

## 5. CSRF and CORS

- [ ] Browser/session apps keep CSRF enabled (token in forms or `X-XSRF-TOKEN` header).
- [ ] Stateless bearer-token APIs may disable CSRF together with `SessionCreationPolicy.STATELESS`; never disable it for cookie-authenticated endpoints.
- [ ] CORS configured once via a `CorsConfigurationSource` bean with explicit origins, methods and headers; no `*` origins with credentials.

## 6. Headers

- [ ] CSP (`default-src 'self'` as a start), `frameOptions` deny/sameOrigin, `contentTypeOptions`, `referrerPolicy`, HSTS behind TLS.

## 7. Abuse limits

- [ ] Gateway or Bucket4j limits on expensive and auth endpoints, keyed per user or client IP (`getRemoteAddr()`, trusted proxy configured); 429 with retry hint; alert on bursts.

## 8. Data exposure

- [ ] DTOs, not entities, in responses; no stack traces (`server.error.include-stacktrace=never`).
- [ ] Logs exclude passwords, tokens, full card numbers and unnecessary personal data.
- [ ] Actuator endpoints restricted (`management.endpoints.web.exposure.include=health,info`, separate port or auth).

## 9. Uploads

- [ ] Max file/request size set; content type and extension allow-listed; stored outside the app with generated names; scanned if required.

## 10. Dependencies

- [ ] OWASP Dependency-Check, Snyk or GitHub dependency scanning in CI failing on the project's severity threshold.
- [ ] Spring Boot and Spring Security on supported versions; security releases applied promptly.

## Release check

Tokens validated and expiring; every sensitive path authorized; inputs validated; no concatenated queries; CSRF posture matches the app type; secrets externalized; headers set; rate limits on; dependencies scanned; logs clean.

_Source: adapted from ECC `skills/springboot-security` (MIT); see NOTICE.md._
