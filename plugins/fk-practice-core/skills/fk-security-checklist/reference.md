# Cloud, CI/CD and infrastructure security (reference)

Read from `fk-security-checklist` step 9. Provider examples are AWS/Cloudflare-flavoured; apply the same rule on any platform.

## IAM and access

- [ ] Least privilege: specific actions on specific resources (`s3:GetObject` on one bucket), never `*:*` on `*`.
- [ ] Root/owner account not used day to day; MFA on every privileged human account.
- [ ] Workloads use roles / workload identity, not long-lived keys; unused credentials removed; periodic access review.

## Secrets in the cloud

- [ ] Production secrets in the platform's secrets manager (or host's encrypted env store), with access audit logging.
- [ ] Rotation for database credentials and API keys on a defined schedule.
- [ ] No secrets in images, IaC state committed to git, logs or error messages.

## Network

- [ ] Databases and caches not publicly reachable (`publicly_accessible = false`, private subnets).
- [ ] SSH/RDP closed to the internet; access via VPN, bastion or session manager.
- [ ] Security groups / firewall rules list only needed ports and sources; egress restricted where practical.
- [ ] Storage buckets private by default; public access only through a CDN or signed URLs.

## Logging and monitoring

- [ ] Platform and application logs centralized; retention meets the project's compliance needs.
- [ ] Failed logins, permission denials and admin actions logged (without sensitive payloads).
- [ ] Alerts on anomalies: error spikes, auth failures, cost spikes, new public resources.

## CI/CD pipeline

- [ ] Workflow tokens with minimal permissions (`permissions: contents: read` by default).
- [ ] Cloud deploys authenticate via OIDC, not stored long-lived keys.
- [ ] Third-party actions/images pinned to a version or digest, not a moving branch.
- [ ] Secret scanning and dependency audit in the pipeline; container image scanning when images are built.
- [ ] Branch protection: required review and green checks before merge to the main branch.

## Edge / CDN

- [ ] TLS everywhere (strict mode end to end); HSTS.
- [ ] WAF managed rules and bot/DDoS protection where the platform offers them.
- [ ] Security headers set at the edge if the app cannot: `X-Frame-Options: DENY` (or CSP `frame-ancestors`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.

## Backups and recovery

- [ ] Automated backups with retention that meets requirements; point-in-time recovery for primary databases.
- [ ] Deletion protection on production data stores.
- [ ] Restore tested on a schedule; RPO/RTO written down; incident runbook exists.

## Pre-deploy cloud checklist

IAM least privilege + MFA; secrets in a manager with rotation; no public databases; logging + alerts; OIDC in CI with scanning; WAF/TLS at the edge; encryption at rest and in transit; tested backups; compliance needs (GDPR, HIPAA, ...) identified; runbooks written.
