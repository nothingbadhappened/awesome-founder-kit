# {{Project}} Security Standard

Baselines: OWASP ASVS L2, API Security Top 10{{#if mobile}}, MASVS L1 + PRIVACY{{/if}}. **[auto]** = run by `check`, CI or e2e. Reviews: `oh-my-claudecode:security-reviewer` per the risk table in `{{project}}-dev`; critical/high/medium block.

## 1. Threat model (R2/R3 or any entry point)
1. Assets: data, money, credentials.
2. Entry points: routes, webhooks, uploads, outbound fetches, deep links, permissions, admin actions.
3. STRIDE (incl. cost abuse as DoS): threat + control, or "n/a because…".
4. Abuse cases.
5. One negative test per real threat.

## 2. Server and API
- AuthN: strong sessions (passkeys preferred); re-auth for sensitive actions.
- AuthZ: object-level checks in the application layer, deny by default. **[auto]** every route: another user's resource ⇒ 403/404.
- Input: schema-validated; uploads capped, sniffed, re-encoded; parameterized queries only.
- Output: no stack traces/internal errors; security headers **[auto]**.
- Outbound fetch: SSRF guard (block private IPs after DNS; size/time caps).
- LLM input untrusted: structured outputs, no tools on untrusted text.
- Webhooks: verify signature and timestamp; idempotent.
- Rate and spend limits.
- Secrets only in the secret store, never code/images/logs/bundles **[auto]** scan.
- Standard crypto libraries only.
- Append-only audit log of security events.

{{#if mobile}}## 3. Mobile
Tokens in Keychain/Keystore; no secrets in bundle; TLS only; permissions just-in-time after an explanation screen; validated deep links; release builds without debug features; store privacy labels match the data inventory.{{/if}}

## 4. Supply chain and CI
Lockfile + frozen installs. **[auto]** dependency audit, Semgrep in `check`, Trivy + SBOM in CI. Actions pinned by SHA, least privilege, OIDC to clouds, protected main, approval before prod deploy.

## 5. Dynamic testing
Negative authZ e2e; nightly OWASP ZAP baseline on staging; external penetration test before public launch; `security.txt` and disclosure page after.

## 6. Data terms (before real user data reaches a provider)
Before real personal or sensitive user data goes to an AI, storage or analytics provider, record per provider: storage location, retention, training use, DPA status, deletion route. Until filled, the provider is limited to testing with synthetic data.

## 7. Incidents
Runbook `docs/runbooks/security-incident.md`: contain → assess → notify (GDPR authority within 72 h; local laws: {{jurisdictions}}) → preserve evidence → post-mortem → lesson → rule.
