# {{Project}} Engineering Standards (split into drydock's docs/standards/)

Each `→` section merges under the matching heading of the named drydock file; keep drydock's seeded rules. **[auto]** = enforced by `{{runner}} check`. A rule that seems wrong: follow it, log a lesson, raise a separate reviewed task; never edit or ignore it mid-task.

## → architecture.md: Module boundaries / Dependency direction
- Modular monolith (unless architecture says otherwise). Modules: {{modules}}; one public entry point each; other modules import only that. **[auto]** {{boundary_tool}}.
- Dependencies point inward: transport → application → domain → ports; domain imports no frameworks/SDKs. **[auto]**
- Each external integration ({{external_ports}}) = port + adapters: shared contract tests, recorded fixtures, own rate-limit/retry/auth config, registry entry behind a flag. A new vendor touches only its adapter and registry. **[auto]**
- Cross-module side effects via events (outbox, same transaction), not synchronous chains.
- Every boundary rule in an ADR has a matching fitness gate in `check`, or a `GATE-MISSING` line in the bootstrap task.

## → architecture.md: Error handling / Code
- Domain names; functions ≤ ~40 lines, files ≤ ~400; guard clauses; ≤ 3 nesting levels; comments say why; no commented-out code or magic numbers.
- Strict types, no `any` at boundaries; schema validation at every boundary; API contract from one schema, clients generated. **[auto]** drift check.
- Typed errors, never swallowed; idempotent jobs/webhooks; timeouts, backoff, fallbacks on external calls; money = integer minor units + currency.
- Flags: typed, DB overrides, no flag SaaS without an ADR; new behavior off in prod; test both states; owner + removal date.
- Before adding a dependency, model or dataset check its license (commercial use). **[auto]** license checker. High audit findings fail `check`. A dependency added to fix a checker passes that checker's own rules first.

## → data.md (delete only if no personal data)
- Data inventory as code: every table, bucket, processor, analytics sink holding user-linked data lists class, erasure action, export flag, retention. **[auto]** `check` fails on unregistered ones; an erasure integration test proves deletion.
- Sensitive data ({{sensitive_classes}}): encrypt per user where feasible (erasure = destroy key).
- No personal data in logs, analytics, fixtures; synthetic only. **[auto]**
- Migrations: forward-only, N-1 compatible, breaking = expand → backfill → switch → contract. **[auto]** linter.

## → process.md: Testing (after drydock's Testing volume)
- Deterministic tests (no network, sleeps, wall clock); a bug fix starts with a failing test; fakes or recorded fixtures, never live services.
- Any user flow also gets one end-to-end run of the whole flow (browser, emulator or game run as the domain needs).
- Flaky tests are fixed or quarantined, never re-run until green.

## → process.md: Operations and hygiene
- Structured logs with request/job IDs and pseudonymous user refs; new job/route/adapter gets metrics, alert, runbook line.
- Every created container, volume and service carries a project label with a repo-folder fingerprint; `{{runner}} sweep` acts on labels only, never names.
- Agent worktrees live outside `.claude/` and outside any tool-ignored folder; on Windows keep paths short.
- Agent instructions have one source (`CLAUDE.md`, `.claude/skills/`). Copies for other tools (`AGENTS.md`, `.agents/skills/`) are generated with a `GENERATED` first line; a gate fails on drift and prints the fix command.
