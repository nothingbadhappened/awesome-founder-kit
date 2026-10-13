# {{Project}} Local ⇄ Remote Portability

Same code and artifact on laptop, CI, prod; only runtime config differs. The tooling map in `docs/02-architecture.md` changes together with this file. Lives at `docs/standards/portability.md`.

1. **Config:** runtime env vars only, validated at boot by one schema; `.env.example` lists all; **[auto]** `.env.example` ↔ schema sync check. No build-time env for environment-specific values.
2. **One command interface** `{{runner}}`: `setup`, `up`/`down`, `dev`, `migrate`/`seed`, `check`, `e2e`{{#if ml}}, `eval`{{/if}}{{#if mobile}}, `mobile`, `e2e-mobile`, `release-mobile`{{/if}}, `deploy env=…`, `impact`.
3. **Ports, not if-branches:** locally each external service is a `fake` adapter or local container; real sandboxes opt-in via env; domain code never checks the environment.
4. **Same artifact:** one image per commit, promoted unchanged staging → prod{{#if mobile}}; one mobile build per release through test tracks{{/if}}.
5. **Offline proof:** with no internet or keys, `{{runner}} setup && {{runner}} up && {{runner}} e2e` passes.
6. **Environments:** local/CI = fakes; staging = real vendors, low budgets, synthetic data only; prod = {{hosting}}.
7. **IaC;** no console changes (unavoidable → ADR immediately).
8. **Deploy:** infra plan/apply → migrations (N-1) → release → health checks → smoke test → automatic rollback on failure.
9. **Idle cost:** document what keeps each paid resource awake (pollers, health checks, open connections); scale-to-zero is deliberate.
10. **No orphans:** stop all you start (containers, volumes, networks, temp dirs, dev servers, emulators, ports). Label project resources with a repo-folder fingerprint (e.g. `com.{{project}}.project={{project}}`, `com.{{project}}.fingerprint=<hash of repo path>`); `--rm` for one-shot containers. `{{runner}} sweep` removes leftovers by label/path only, never other projects (tested). Remote ephemeral resources get a TTL and show in `{{runner}} sweep --remote`.
11. **Residency:** sensitive classes pinned to {{default_region}} by config and vendor passports, never hard-coded.
