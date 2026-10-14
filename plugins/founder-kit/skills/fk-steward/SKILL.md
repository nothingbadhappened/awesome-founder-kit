---
name: fk-steward
description: Use when starting a server, container, worktree or cloud resource, near usage limits, every 5 green slices, or on a steward note.
---

# Steward: tokens, machine, cloud bills

Keeps spending and leftovers in check. OMC owns the workflow: this skill adds items to OMC's plan, never runs its own loop, and never blocks a stop.

## 1. Record what you start (always)
Right after starting anything that outlives the command, record it:
```
fk ledger add <kind> <id> [--pid N] [--port N] [--ttl 2h] [--label k=v] [--data]
```
- kinds: `dev-server`, `emulator`, `process` (give `--pid`), `container`, `volume` (data), `worktree` (path), `tmpdir` (path), `cloud` (provider resource id).
- `--ttl`: how long it should live; the sweep keeps it until then.
- Containers and volumes: also start them with `--label fk.fingerprint=<fp>` (`fk ledger fp` prints it), so the sweep finds them by label.
- Something that was already there before the agent touched it: `--pre-existing`. The sweep never touches it.
- Subagent worktrees: `isolation: worktree`, outside `.claude/`; record the path.

## 2. Sweep (end of a work block, and when the steward note asks)
1. `fk sweep --dry-run` and read the list.
2. `fk sweep` stops processes, removes containers, merged clean worktrees and temp folders from this project's ledger or label. Never by name.
3. Volumes and other data: only `fk sweep --include-data`, and only after the founder said yes (AskUserQuestion).
4. Cloud resources are listed, never deleted by the kit. Deleting cloud resources not in the ledger is the founder's call.
5. Containers work the same with Podman or Docker (`fk sweep` uses whichever is there). The Podman machine (Windows, macOS) holds memory while idle: when no containers are needed, `podman machine stop` (`fk doctor` shows whether it runs). Never `podman machine rm` or `reset` without the founder's yes: it deletes every container and volume in it.

## 3. Cloud budgets
- Before the first paid resource on a provider: `fk budget plan <provider> <usd>`. It prints the steps and writes budget-as-code into `infra/budgets/<provider>/`. You never apply it; the founder runs `terraform apply`/console steps.
- The founder records it by typing `fk-approve budget <provider> <usd> [hard-cap]`. cloud-guard needs this before any create/deploy.
- Prefer providers with a hard cap (the plugin catalog `catalog/providers/<p>.json`: `hard_cap`, `traps`; `fk budget plan` prints them). Alert-only providers need the founder's written reason in `docs/process/founder-actions.md`.
- `fk budget check` reads caps back through the provider CLI where possible. Report "verified" or "unverified" in plain words; never claim a cap you could not read.
- Label every cloud resource: `fk-project`, `fk-fingerprint`, `fk-ttl`.

## 4. Claude token pacing
- Plan with a conservative limit until a real limit hit is seen; then use 80% of that hit (20% margin).
- At most 3 concurrent agents.
- opus only for architecture, security and critique; sonnet builds; haiku searches.
- One commit per green slice, so a cut-off costs at most one slice.
- Check usage: `/usage`, or `fk budget usage` if the founder approved ccusage in the toolchain.
- Unattended runs: `OMC_BUDGET_ENFORCE=active`; headless runs: `--max-budget-usd`.

## 5. Maintenance slice (every 5 green slices, or on a code-health threshold)
Trigger when either holds:
- 5 green slices since the last maintenance slice; or
- codebase-memory-mcp (if present) shows a threshold crossed: a function with high complexity, an import cycle, a file over ~400 lines, or dead code (`search_graph`, `get_architecture`, `detect_changes`).

Then add up to 3 items to OMC's plan (not a separate loop): refactor the worst hotspot, delete dead code, patch/minor dependency updates with gates green. Majors go through an ADR.
- Cap: at most 10% of the session's budget on maintenance.
- Stop maintenance when under 20% of the usage window remains; feature work and a clean commit come first.

## 6. Weekly and 90-day notes
The SessionStart note says when the weekly sweep and budget check are due, or when the toolchain is over 90 days old (suggest re-running fk-scout; install nothing without a yes). One note per session at most. A separate note asks for `fk metrics` once 3 tasks have closed: tell the founder in plain words what it shows (tokens and cost, rework, catches vs false alarms).
