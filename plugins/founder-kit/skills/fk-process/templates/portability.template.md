# {{Project}} Local ⇄ Remote Portability

Same code and artifact on laptop, CI, prod; only runtime config differs. A fresh clone runs with the setup command (`{{setup}}`) and the check command (`{{check}}`): runtimes pinned the way this ecosystem does (exact versions, never `latest`), each service reachable the way the architecture chose (container file, test containers, or a documented hosted instance), large binaries in Git LFS, `.gitattributes` line endings, no machine paths. `fk portability check` lists the gaps; a CI job running `{{check}}` on a fresh machine proves it. The tooling map in `docs/02-architecture.md` changes together with this file. Lives at `docs/standards/portability.md`.

1. **Config:** runtime env vars only, validated at boot by one schema; `.env.example` lists all; **[auto]** `.env.example` ↔ schema sync check. No build-time env for environment-specific values.
2. **One place for commands** ({{commands_file}}, where this project already keeps them): setup, start/stop the local stack, dev, migrate/seed, check, e2e{{#if ml}}, eval{{/if}}{{#if mobile}}, mobile build, mobile e2e, mobile release{{/if}}, deploy per environment, impact.
3. **Ports, not if-branches:** locally each external service is a `fake` adapter or a local instance started the way the project chose; real sandboxes opt-in via env; domain code never checks the environment.
4. **Same artifact:** one image per commit, promoted unchanged staging → prod{{#if mobile}}; one mobile build per release through test tracks{{/if}}.
5. **Offline proof:** with no internet or keys, setup, starting the local stack and the end-to-end tests pass.
6. **Environments:** local/CI = fakes; staging = real vendors, low budgets, synthetic data only; prod = {{hosting}}.
7. **IaC;** no console changes (unavoidable → ADR immediately).
8. **Deploy:** infra plan/apply → migrations (N-1) → release → health checks → smoke test → automatic rollback on failure.
9. **Idle cost:** document what keeps each paid resource awake (pollers, health checks, open connections); scale-to-zero is deliberate.
10. **No orphans:** stop all you start (containers, volumes, networks, temp dirs, dev servers, emulators, ports). Label project resources with a repo-folder fingerprint (e.g. `com.{{project}}.project={{project}}`, `com.{{project}}.fingerprint=<hash of repo path>`); `--rm` for one-shot containers. `fk sweep` removes leftovers by label/path only, never other projects (tested). Remote ephemeral resources get a TTL and a listed cleanup command.
11. **Residency:** sensitive classes pinned to {{default_region}} by config and vendor passports, never hard-coded.
