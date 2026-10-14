---
name: fk-docker-patterns
description: Use when writing or reviewing Dockerfiles and Compose files - multi-stage builds, local dev stacks, networking, volumes, hardening, secrets, .dockerignore and debugging.
---

# Docker patterns

Project ADRs decide where containers run in production; Compose is for local development and simple single-host setups, not a substitute for an orchestrator.

## Dockerfile

1. Pin base images to a specific version (and digest for release images); never `:latest`.
2. Multi-stage: `deps` (install from lock file, e.g. `npm ci`) -> `dev` (hot reload) -> `build` (compile, prune dev deps) -> `production` (minimal runtime, only built artifacts).
3. Copy dependency manifests before source so the dependency layer caches.
4. Run as a non-root user with a fixed UID/GID; `COPY --chown` for app files.
5. `HEALTHCHECK` hitting a cheap health endpoint; exec-form `CMD ["node", "dist/server.js"]` so signals reach the process.
6. No secrets in `ENV`, `ARG` or layers; use runtime env vars or build secrets (`--mount=type=secret`).

## .dockerignore

Exclude `.git`, dependency folders, build output, coverage, logs, local env files, test fixtures not needed at runtime, and Compose/Dockerfiles themselves. A missing `.dockerignore` leaks secrets and slows builds.

## Compose for local development

- One service per process: `app`, `db`, `cache`, optional mail catcher.
- `app` builds the `dev` target, bind-mounts source for hot reload, and uses an anonymous volume to protect container-installed deps (`/app/node_modules`).
- `depends_on` with `condition: service_healthy`; give the database a `healthcheck` (`pg_isready`).
- Named volumes for data (`pgdata:`); `docker compose down -v` deletes them, so never run it casually.
- Dev-only settings (debug ports, verbose logs) in `docker-compose.override.yml`; production-like settings in an explicit `-f docker-compose.prod.yml` with restart policy and resource limits.
- Local credentials in Compose are for throwaway dev databases only; real secrets come from a git-ignored env file or the platform's secret store.

## Networking

- Services reach each other by service name (`db:5432`).
- Split networks so the database is only on the backend network.
- Publish ports only when the host needs them, bound to `127.0.0.1` for local tools; omit `ports` for internal services.

## Hardening (production-like containers)

```yaml
security_opt: ["no-new-privileges:true"]
read_only: true
tmpfs: ["/tmp"]
cap_drop: ["ALL"]          # add back only what is needed, e.g. NET_BIND_SERVICE
pids_limit: 256
```

Also: scan images in CI, rebuild regularly for base-image patches, keep images small (alpine/distroless where compatible).

## Test harnesses in containers

- Linux containers validate Linux only; macOS and Windows behaviour needs native CI runners.
- For tools that mutate a project: mount the source read-only, copy into a writable tmpfs workspace, no network by default, no host credentials mounted, argument arrays instead of shell strings.

## Debugging

- Logs: `docker compose logs -f app`, `--tail=50`.
- Shell: `docker compose exec app sh`; DB: `docker compose exec db psql -U <user>`.
- State: `docker compose ps`, `docker compose top`, `docker stats`.
- Network: `docker compose exec app nslookup db`, `wget -qO- http://api:3000/health`, `docker network inspect <project>_default`.
- Rebuild: `docker compose up --build`; `build --no-cache <svc>` for a clean layer cache.

## Review checklist

- [ ] Pinned base images, multi-stage, non-root, healthcheck, exec-form CMD
- [ ] `.dockerignore` present and excludes secrets and VCS data
- [ ] No secrets in images or committed Compose files
- [ ] Data in named volumes; databases not published beyond localhost
- [ ] Hardening options on production-like services

_Source: adapted from ECC `skills/docker-patterns` (MIT); ECC-specific installer harness instructions removed; see NOTICE.md._
