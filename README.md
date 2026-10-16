# Founder Kit

Founder Kit lets someone who is **not** a programmer build a real product with AI agents in Claude Code. [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) (OMC) runs the development workflow: planning, building, verifying, reviewing. The kit never replaces it. It adds the founder layer on top (idea, honest review, decisions, brand, journal) and light governance (records, checks and guards) so the work keeps to what you agreed, in any kind of project.

> Status: **v0.9.0**. The rules come from real projects, mistakes included. Expect changes.

## Who it is for, and what you get

You decide *what* and *why*; the agents research, plan, build, check each other and keep records. You get:
- your idea written down in full, an honest business and architecture review, and every decision as a short record (an ADR);
- tools researched for *your* project, proposed in plain words, installed only after your yes;
- one checklist of the things only you can do (accounts, key names, billing caps, approvals);
- guards against leaked secrets, quietly loosened checks, unapproved installs, surprise cloud bills and leftover processes;
- a project that still works on a fresh computer.

## Install

One command installs what the kit needs and is missing: git with Git LFS, Node.js, uv, mise, just, the GitHub CLI (gh), Podman (an existing Docker is kept instead), Claude Code, OMC, codebase-memory-mcp, MemPalace, NVIDIA SkillSpector, gitleaks and the kit itself. All free. Podman with its small Linux machine takes about 1–2 GB.

**Windows** (PowerShell):

    irm https://raw.githubusercontent.com/nothingbadhappened/awesome-founder-kit/main/install/install.ps1 | iex

**macOS / Linux** (Terminal):

    curl -fsSL https://raw.githubusercontent.com/nothingbadhappened/awesome-founder-kit/main/install/install.sh | bash

- It checks what you have, shows **one plan** in plain words (what, why, size), asks **once**, installs only what is missing, sets each tool up and checks it works. It never uninstalls or downgrades anything and is safe to run again.
- Versions are pinned in [`plugins/founder-kit/compat.lock.json`](plugins/founder-kit/compat.lock.json) (for example OMC 5.7.2, gitleaks 8.30.1, Node 24 LTS).
- Every change is logged with its undo command in `~/.fk/install-ledger.jsonl`; what you already had is logged as yours and never touched.
- Steps only you can do are shown with the exact command and stay on your to-do list: on Windows, WSL2 for Podman (administrator rights and a restart); everywhere, `gh auth login`.
- Preview without changes: `-DryRun` / `--dry-run` (piped: `$env:FK_DRY_RUN='1'` first, or `| bash -s -- --dry-run`). Skip the question: `-Yes` / `--yes`.

**Already have Claude Code?** Inside it run `/plugin marketplace add nothingbadhappened/awesome-founder-kit` and `/plugin install founder-kit@awesome-founder-kit`, then say **"Start my project with fk-start"**. Its first step runs `fk setup`, which installs the rest the same way (it adds the OMC plugin only when OMC is missing and keeps an npm install of OMC as it is).

## Start a project

Open Claude Code in an empty folder and say **"Start my project with fk-start."** It keeps its place in `docs/process/kickoff-status.md`, so you can stop and resume.

| Step | What happens | You get |
|---|---|---|
| 0. Base tools | `fk setup` | Everything above, installed and checked |
| 1. Record | `fk init`; OMC's autopilot/ralph stay off until step 3 is done | Git, guards, project folders |
| 2. Idea | `fk-idea-import` (chat link, export, notes, voice memo) | `docs/00-source.md`: your brainstorm, in full |
| 3. Non-negotiables | `fk-kickoff` | Market, platforms, red lines, budget in `docs/00-constraints.md` |
| 4–5. Review and decide | `fk-kickoff` with OMC reviewers | Honest business and architecture review; decisions as ADRs |
| 5b. Bible | `fk bible init` | `docs/PROJECT.md`, the one page to start from |
| 6. Tools | `fk-scout` → you type `fk-approve proposal <id>` → `fk-provision` | Tools researched for your domain, scanned, pinned, verified |
| 7. How work is done | `fk-process` (+ an optional practice pack) | Standards, risk classes, gates, a short `<project>-dev` skill over OMC |
| 8. Look and voice | `fk-brand` (only with a UI) | `design-system/` and a design skill |
| 9. Your to-do list | `fk-actions`, `fk-steward` | One checklist; spending caps only for paid cloud or API services |
| 10–12. Build | your project skill + OMC | The first task builds the checks themselves, each shown failing once |

**Already have a project?** `fk-adopt` brings it in without disturbing work in progress:
- **Survey, read-only.** Nothing in the repo changes until you approve the health report; work in progress, branches and OMC's `.omc/` state are left alone.
- **Knowledge consolidation.** Your docs, agent rule files (CLAUDE.md, .cursorrules, …), notes and past sessions are read; agents find contradictions, duplicates and stale items. The **newer statement wins** unless you decide otherwise; you are asked in plain words only where dates cannot settle it. The result becomes the bible, ADRs, standards and lessons, with a map of where each old doc went. Originals get a "consolidated into …" line only if you agree; agent rule files are never rewritten.
- **Bible mode.** No vision doc: the bible holds the summaries (*own*). A vision doc, game design doc or PRD already exists: the bible becomes a thin index of it (*index*).
- **Baseline ratchet.** Today's problem count for each existing check (tests, lint, …) and the secret scan is recorded; later they may only get better (`fk baseline check`).

## Works for any kind of project

Nothing assumes a website. `fk-scout` turns your project into capabilities, researches tools for each one live, scores them (`fk score`) and checks each for conflicts with the base setup (`fk interference`). The picks below are examples of what that research might propose, not a fixed list.

| Project | Capabilities | Might propose | Skipped |
|---|---|---|---|
| A Unity endless-runner | Agent drives the editor, command-line builds per platform, play/edit-mode tests, large assets, size budget | A Unity MCP server (the higher-scoring one; the other is noted as runner-up), Unity Test Framework, Git LFS + UnityYAMLMerge, a build-size check | Billing caps, unless it gets an online backend |
| An ESP32 plant sensor | Build and flash, serial log, logic tests without the board, real-hardware checks | The PlatformIO or ESP-IDF command line, host-side unit tests | Hardware-in-the-loop stays a step on your list; no agent fakes it |
| An interview podcast | Even loudness, transcripts, a source for every claim, publishing the feed | A loudness CLI, a transcription tool, a reference manager; gates such as "every episode hits the loudness target" | Code, frameworks and practice packs |

An add-on that brings its own workflow, hooks or rewrites of CLAUDE.md is cut down to its useful part or rejected.

## How the process stays alive

- **One page to start from.** `docs/PROJECT.md` (at most 60 lines) summarizes mission, users, red lines, principles and architecture and links to the details. Each session starts with one short "read-first" line: the bible, the open task, the newest decisions. A parent project's bible can be linked (`fk config set parent`).
- **Decisions and lessons find the work.** Each ADR and lesson names the folders it applies to (`applies_to`, `paths`). A new task lists the ones that matter; the first edit in such a folder gets a one-line note. Import boundaries written in an ADR (`fit:` rules) become a small checker script (`fk gates build`) that runs with your checks.
- **Nothing goes quietly stale.** `fk audit`, `fk bible check` and weekly session notes flag skipped decisions, replaced ADRs still cited, lessons ready to become checks, and bible sections a newer decision changed. `fk knowledge check` pairs new doc statements with the decisions on the same topic for an agent to judge; it can miss a contradiction worded very differently.
- **Risk class from the change.** `fk risk` proposes R0–R3 from the actual diff (auth, money, migrations, infrastructure, CI and gate files, new dependencies, API contracts, your impact map). Agents may raise a class, never lower it.
- **Acceptance criteria, independent reviews.** `fk task new` writes `docs/tasks/<id>.md` with checkable criteria (or takes them from an OMC plan or PRD). Each review carries the `fk task stamp` of the exact version it saw; a review of an older version does not count. `fk task done` closes a task only with reviews from agents that wrote no code for it: none at R0, one at R1; from R2 the code and security reviewers, every criterion PASS with evidence and every cited ADR answered; at R3 also the critic and two rounds. Nothing blocks work in progress.
- **Is it paying off?** `fk metrics` shows per task the estimated tokens and cost, time to done, rework, regressions, and what guards and reviews caught versus your overrides (likely false alarms).
- **Memory.** codebase-memory-mcp maps the code; MemPalace keeps history; decisions and lessons live in your repo.

## Spending, cleanup, portability

- **Spending caps, only if you pay for cloud or API services.** `fk budget plan <provider> <usd>` writes the steps and budget-as-code (it never applies anything), preferring providers with real hard caps; you record the cap with `fk-approve budget …`; `fk budget check` reads caps back where the provider allows. Resource-creating cloud commands need a recorded budget, then your yes.
- **Nothing left running.** Agents record what they start (`fk ledger add`); `fk sweep` stops or removes only this project's recorded or labelled items, never by name, data only on request.
- **Portable from day one.** A fresh clone must run with `just setup` and `just check`: tools pinned with mise, services in containers, lockfiles committed, nothing machine-specific. `fk portability check` shows the gaps (including a missing fresh-clone CI job); `fk portability init` adds the kit's justfile and fresh-clone CI job (never over an existing file).

## Guards, and how strong they really are

**What they guard.** Six guards run as Claude Code hooks: **secrets** (secret-shaped strings in files or commands, reading `.env`), **gates** (loosening a lint, test or CI setting, the check command or the kit's own files), **installs** (only approved tools at pinned versions; it only logs until you approve a first tool), **cloud** (spending without a budget), **git** (`--no-verify`, overriding the hooks path, force-pushing main) and **iteration** (endless redo loops on work only you can judge, see below). They log to the kit's folder in your home directory (`~/.fk/`); `fk audit` summarizes it in plain words. They never block OMC's workflow, and a false alarm on ordinary work is treated as a bug: new config files, tightening a rule, local-dev passwords in compose files and made-up secrets in test folders all pass.

**Threat model, plainly.** Agents run as you, so anything you can write, they can write, `~/.fk/` included. The guards are text checks: they stop an agent that drifts from what was agreed, not one that sets out to get around them (an inline script, a path spelled another way). The kit does not claim its records cannot be forged. Against a determined agent the real boundary is **Claude Code's sandbox**:
- `fk init` merges deny rules for `~/.fk` into the project's `.claude/settings.json` (file tools and recognised shell file commands), a sandbox write-deny for `~/.fk`, and lets the `fk` CLI run outside the sandbox (Claude Code asks first). `fk uninstall` takes exactly these out again.
- They take full effect only with the sandbox on (`/sandbox`). The kit does not switch it on for you, because it also limits network access. It exists on macOS, Linux and WSL2; **native Windows has no Bash sandbox**, so use WSL2 there for the strong form.
- `fk doctor` shows a **guard strength** row: green with the sandbox on and the deny rules in place; otherwise yellow: "Without Claude Code's sandbox, the guards stop drifting agents, not a determined one."

**Approvals only you can type.** A line counts only when it is your whole message (pasted text that contains one is ignored, and an agent cannot start a nested Claude session to type it):

| You type | What it does |
|---|---|
| `fk-override <guard> <reason>` | Lets one guard pass for 30 minutes (`secret`, `gate`, `install`, `cloud`, `git`, `iteration`, `task-check`, `kickoff`). While a `gate` override is active, gate-file changes made from the shell become the new accepted state (recorded in `fk audit`). |
| `fk-approve proposal <id> [without <names>]` | Approves the tool proposal exactly as you saw it |
| `fk-approve tool <name@version \| mcp:<name> \| plugin:<id> \| brew:<name> \| enforce> <reason>` | Adds one tool to the approved list (or switches the install guard to blocking) |
| `fk-approve budget <provider> <usd/month> [hard-cap]` | Records a monthly spending cap |
| `fk-approve gates <check\|fast_gates\|runner> "<command>" <reason>` | Lets a gate command change other than by adding steps (once, 30 minutes) |
| `fk-approve rounds <n\|off>` | Sets how many generate/render calls agents may make between check-ins with you (default 3), or turns the iteration guard off |
| `fk-approve baseline <reason>` | Lets `fk baseline record` replace an existing baseline (once, 30 minutes) |
| `fk-approve update <version> <reason>` | Lets an agent run `fk update --yes` to exactly that version (once, 30 minutes) |

Some steps are hard stops with no override: taking the kit out (`fk uninstall`, the installers' uninstall flags) or deleting `.fk/` from an agent shell, writing into `~/.fk`, and feeding events to the kit's hooks.

**Known gaps** (the backstops are `fk audit`, session-bound approvals and after-the-fact checks):
- Approval records are written only by the hook Claude Code starts for the installed plugin; an agent that copies the kit and fakes that environment in a shell the guard does not see could still write one. `fk audit` lists every approval without a matching typed line.
- A gate file changed by a shell command is caught right after the command, not before.
- The iteration guard knows producing tools by name (generate, render, export, compose… and a few renderers such as `remotion render`); a tool named otherwise is counted only after you list it in `.fk/config.json` `producers`, and a developer tool it miscounts goes in `not_producers`. A scheduled or looped prompt (`/loop`) looks like you speaking and resets its count.
- A forged `.fk/` file that was also committed is trusted on a fresh machine; `fk audit` and code review are there to catch it.
- If git does not run the kit's pre-commit hook in a clone (another hooks folder such as husky), session start and `fk doctor` say so; `fk init --chain` adds the kit's call to that folder.

## Updating

Nothing updates by itself. At most once a day, session start mentions a new version in one line.
- `fk update --check` shows what changed since your version ([CHANGELOG.md](CHANGELOG.md)), changing nothing.
- `fk update` shows the plan, asks once, updates the kit and any practice packs, checks your tools against the new pinned list (asking again only if something needs installing), updates the kit's saved state, then runs `fk doctor`. Restart Claude Code afterwards. Asked from Claude Code, it shows the plan and the line you type to approve it: `fk-approve update <version> <reason>` (once, within 30 minutes). It never goes back to an older version; `--dry-run` prints the plan only; `--to <version>` for a release older than the newest prints the exact manual steps to follow that release.

## Uninstalling

Always run by you in a terminal (it refuses inside Claude Code):
- **One project:** `fk uninstall` takes the kit out of that project (its `.fk/` folder, git hook settings, the rules it added). Your docs, `.omc/` and your own code stay.
- **The computer:** `fk uninstall --system` (or `install.ps1 -Uninstall`, `install.sh --uninstall`) lists only what the kit installed, changed or created, from its install list. Anything you had before is never listed. Pick with numbers, `a` (all), `n` (none) or `p` (just the kit plugin), then confirm once. Your data (the memory store, the kit folder) goes only if you select it; the Podman machine (with its containers) asks separately.
- **Projects first.** When the kit plugin is going, it lists each project still set up for the kit, with the tools `fk provision` added there, and asks per project (or `a` for all): roll those tools back (`fk provision rollback <name>`), then take the kit out of the project (`fk uninstall`). Both run before anything is removed, because they need the kit. A project whose rollback fails keeps its kit setup so the rollback can be retried.
- **Without questions:** `--dry-run` previews; `--yes` with `--only <ids>`, `--keep <ids>` or `--plugin-only`; add `--rollbacks` and `--projects` to include the project steps.

## Practice packs (optional)

Packs for common stacks, loaded only when needed: `fk-practice-core` (standards, API design, architecture, errors, security checklist) and `web`, `python`, `go`, `jvm`, `apple`, `rust`, `dotnet`, `php`, `llm`. They are a shortcut, not a limit: for other stacks (game engines, embedded, audio, …) `fk-scout` finds and vets community skills, plugins and MCP servers instead. Adapted from [ECC](https://github.com/affaan-m/ECC) (MIT); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Evidence

- **Automated tests** (`plugins/founder-kit/tests/`): guards with planted and clean events, the CLI, adoption and knowledge consolidation, setup, install ledger, uninstall and update (570 tests, run in temporary folders with fakes, no real installs). CI runs them on Ubuntu and Windows, validates the marketplace and every plugin with `claude plugin validate --strict`, and scans the repo with gitleaks.
- **Real-install smoke tests** (`.github/workflows/smoke.yml`): on every push to main and weekly, the one-line installer on a fresh Ubuntu 24.04 container and on macOS (Podman skipped there), a dry run on Windows, then `fk doctor --hooks`, `fk init` and planted guard events.
- **Agent-quality A/B suite** ([evals/README.md](evals/README.md)): the same prompts and model with the kit, with no plugin and with OMC alone, on traps such as crossing an ADR boundary, loosening a gate to get green, an unpinned global install, or closing a task after a post-review change, with a fixed pass bar. `bash evals/run.sh validate` checks the suite for free. **The paid runs have not been published yet**, so the pass bar is a target, not a result.

## The rules that make it work

1. **Write everything to files.** Agents forget; files don't.
2. **Front-load your constraints.** A correction sent mid-task often arrives too late.
3. **Decisions become ADRs.** No re-arguing; changes are explicit.
4. **Never self-approve.** The reviewer is never the agent that wrote the change.
5. **Checks are code, not promises.** Each is shown failing once before it counts and is never loosened without your approval.
6. **Check what else is affected:** the code (code graph) and everything else (legal texts, store listings, design, tests).
7. **Ask what a bad actor could do:** from R2 (and at every entry point) a threat model, abuse cases and one test per real threat.
8. **Nothing left running, no surprise bills:** record what you start, sweep by record, cap paid services at the provider.
9. **Log failures honestly.** That is where the method improves.
10. **Portable from day one:** a fresh clone runs with `just setup` and `just check`.

## Command reference

Agents run most of these for you; you rarely type them.

| Command | Purpose |
|---|---|
| `fk setup` | Install and check the base tools (`--dry-run`, `--yes`) |
| `fk doctor [--hooks]` | Health check, including guard strength; `--hooks` replays planted guard events |
| `fk init [--chain]` / `fk uninstall [--system]` | Put the kit into a project / take it out (of the project, or of the computer) |
| `fk update` | Show what changed and update the kit after one yes |
| `fk config set <key> <value>` | Set gate commands and a few safe settings (gate commands may only grow without your approval) |
| `fk kickoff protect\|release` | Keep OMC's autopilot/ralph off until the non-negotiables are committed |
| `fk audit` | Plain-words summary: blocks, overrides, approvals not typed by you, task and knowledge drift |
| `fk adopt …` | Bring an existing project in (survey, knowledge consolidation, plan, apply) |
| `fk bible init\|touch\|check` | The project bible (`docs/PROJECT.md`) |
| `fk index` / `fk knowledge check` | Show the knowledge index / find doc statements that may contradict decisions |
| `fk gates build` | Turn ADR `fit:` rules into a checker script |
| `fk baseline record\|check` | The adoption ratchet |
| `fk task new\|context\|stamp\|check\|done\|reopen\|list` | Task records, acceptance criteria and independent reviews |
| `fk risk` | Propose R0–R3 from the actual change |
| `fk lessons …` | Record, count and promote lessons |
| `fk scout …` / `fk score` / `fk interference` | Tool proposal, scoring, conflict check |
| `fk provision <id>` / `fk provision rollback <name>` | Install approved tools / take one back out |
| `fk actions` | The founder checklist |
| `fk budget plan\|check\|usage` | Spending caps for paid cloud or API services |
| `fk ledger …` / `fk sweep` | Record what agents start / clean up only that |
| `fk memory setup\|status\|forget` | Limit memory tools per project; inspect or purge stored memory |
| `fk metrics` | Is the process paying off |
| `fk portability check\|init` | Fresh-clone readiness |

## License

MIT (see [LICENSE](LICENSE)). Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
