# Founder Kit

Build a real product with AI agents when you are **not** a programmer. You decide *what* and *why*. The agents research, plan, build, check each other and keep records. Nothing is approved by the same agent that made it.

[oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) (OMC) runs the development workflow: planning, building, verifying and reviewing. The kit never replaces it. It adds what OMC does not do: the founder layer (idea, review, decisions, brand, journal), tool research and setup for any kind of project, light checks that the work follows what was agreed, and guards for secrets, spending and cleanup.

> Status: **v0.6**. The rules come from real projects, including the mistakes. Expect changes.

## Install

One command installs everything the kit needs: git, Node.js, uv, Claude Code, oh-my-claudecode, codebase-memory-mcp, MemPalace, NVIDIA SkillSpector and gitleaks. All are free.

**Windows** (PowerShell):

    irm https://raw.githubusercontent.com/nothingbadhappened/awesome-founder-kit/main/install/install.ps1 | iex

**macOS / Linux** (Terminal):

    curl -fsSL https://raw.githubusercontent.com/nothingbadhappened/awesome-founder-kit/main/install/install.sh | bash

The installer checks what you already have, shows one plan in plain words (what, why, size), asks once, installs only what is missing, sets each tool up and checks that it works. It never uninstalls or downgrades anything and is safe to run again. Every change is logged with an undo hint in `~/.fk/install-ledger.jsonl`. Exact versions come from `plugins/founder-kit/compat.lock.json`.

Options: preview with `-DryRun` / `--dry-run`; skip the question with `-Yes` / `--yes`; add the GitHub CLI with `-WithGh` / `--with-gh`. When piping, use `$env:FK_DRY_RUN='1'` (Windows) or `| bash -s -- --dry-run`.

Already have Claude Code? Inside it:

    /plugin marketplace add nothingbadhappened/awesome-founder-kit
    /plugin install founder-kit@awesome-founder-kit

then say **"Start my project with fk-start"**; step 0 runs `fk setup` to install the rest (OMC included: it adds the OMC plugin only when OMC is missing, and keeps an npm OMC as it is).

## How it works

Open Claude Code in an empty folder (or in a project you already have) and say **"Start my project with fk-start."**

| Step | Skill | You get |
|---|---|---|
| 0. Base tools | `fk setup` | Everything above installed and checked |
| 1. Your idea | `fk-idea-import` | `docs/00-source.md`: your brainstorm, in full |
| 2. Non-negotiables | `fk-kickoff` | Market, platforms, red lines, budget, written down |
| 3. Honest review + plan | `fk-kickoff` (OMC agents) | Business review, architecture, decisions as ADRs |
| 4. Tools for *your* project | `fk-scout` → `fk-provision` | Research of proven tools and community experience for any domain, checked for conflicts with the base setup, one plain-language proposal you approve once, then installed, scanned and verified |
| 5. How work is done | `fk-process` (+ an optional `fk-practice-*` pack) | Project standards, gates and a short skill over OMC's workflow |
| 6. Look and voice | `fk-brand` | `design-system/` + a design skill |
| 7. Your to-do list | `fk-actions` | Accounts, key names, approvals, and billing caps if you use paid cloud or API services: one checklist |
| 8. Build | your project skill + OMC | The first task builds the safety checks themselves |

Already have a project? `fk-adopt` surveys it read-only, reconstructs the decisions, records today's quality as a baseline that may only improve, and leaves work in progress alone.

While building:
- **Conformance:** reviewers load `fk-conformance` and check each change against your decisions and standards; boundary rules become automatic checks.
- **Learning:** `fk-learn` records each failure once, counts repeats and turns repeated lessons into checks.
- **Stewardship:** `fk-steward` logs everything agents start, cleans up only this project's leftovers (`fk sweep`), and, only when your project uses paid cloud or API services, plans a spending cap per provider (`fk budget plan`), preferring providers with real hard caps. The provider catalog exists for that alone; it is not a list of recommended tools.
- **Risk class from the change:** `fk risk` proposes R0–R3 from the actual diff (auth, money, migrations, infrastructure, CI and gate files, new dependencies, API contracts, your impact map). Agents may raise a class, never lower it.
- **Acceptance criteria as a check:** `fk task new` writes `docs/tasks/<id>.md` with checkable criteria (or imports them from an OMC plan or PRD). Reviewers mark each one PASS or FAIL with evidence; `fk task done` closes the task only when reviewers who wrote no code for it accepted it, as many as the risk class needs (from R2, every criterion PASS). Nothing blocks work in progress. In OMC's ralph PRD mode OMC already verifies each story's criteria; the kit adds reviewer independence (who wrote what) and the same check for work outside ralph.
- **Is it paying off:** `fk metrics` shows per task the estimated tokens and cost, time to done, rework, regressions, and what the guards and reviews caught versus your overrides (likely false alarms).
- **Memory:** codebase-memory-mcp maps the code; MemPalace keeps history; decisions and lessons live in your repo files.

### How decisions and lessons stay alive
- **One page to start from:** `docs/PROJECT.md` (the project bible, at most 60 lines) summarizes mission, users, red lines, principles and architecture and links to the details. If you already have a vision doc, game design doc or PRD, it becomes a thin index of that doc instead. A parent project's bible can be linked too (`fk config set parent`).
- **Every session starts oriented:** one short line points at the bible, the open task and the newest decisions.
- **Decisions find the work:** each decision (ADR) and lesson names the folders it applies to. A new task lists the ones that matter for it, and the first edit in such a folder gets a one-line reminder.
- **Rules become checks:** import boundaries written in an ADR turn into a small checker script (`fk gates build`); from R2, reviewers confirm each relevant decision was kept.
- **Nothing goes quietly stale:** `fk audit` and `fk bible check` flag tasks that skipped a decision, references to replaced decisions, lessons waiting to be promoted, and bible sections a newer decision changed.

## Works for any kind of project
Nothing in the kit assumes a website. `fk-scout` turns your project into capabilities, researches tools for each one live, scores them and checks each for conflicts with the base setup. The tools below are examples of what that research typically proposes, never a fixed list: the winner comes from current evidence and the score.

**A 3D endless-runner game in Unity**
- Capabilities: let the agent drive the editor and scenes, build for each platform from the command line, run play-mode and edit-mode tests, version large assets, keep the game within a size budget.
- Typically proposed, for example: a Unity MCP server (official or community, whichever scores higher; the other is recorded as runner-up), Unity's command-line builds, Unity Test Framework, Git LFS with Unity `.gitignore`/`.gitattributes` and UnityYAMLMerge for scenes, an asset and build-size check.
- Interference check: an add-on that brings its own planner agent, session hooks or rewrites CLAUDE.md is cut down to its useful parts or rejected. An existing repo keeps its own agent rules (`fk-adopt`).
- Skipped: cloud billing caps, unless the game gets an online backend.

**An ESP32 plant-watering sensor**
- Capabilities: build and flash firmware, read the serial log, test logic without the board, check it on real hardware.
- Typically proposed, for example: the PlatformIO or ESP-IDF command line, its serial monitor, unit tests that run on the computer.
- Interference check: MCP servers for embedded work get little trust, so mature command-line tools win.
- Skipped: hardware-in-the-loop runs are a manual step on your to-do list, not something an agent fakes.

**A weekly interview podcast**
- Capabilities: even loudness across episodes, transcripts, sources for every claim, publishing the feed.
- Typically proposed, for example: a loudness-normalization CLI, a transcription tool, a reference manager; the podcast host account is a founder action.
- Interference check: a transcription add-on that also ships its own workflow or hooks keeps only the transcription part.
- Quality gates: every episode hits the loudness target; every claim in the show notes has a citation.
- Skipped: code, frameworks and practice packs. There is no code at all.

## Practice packs
Optional extras for common stacks, loaded only when needed: `fk-practice-core` (standards, API design, architecture, errors, security checklist) and stack packs (web, python, go, jvm, apple, rust, dotnet, php, llm). They are a shortcut, not a limit: for any other stack (game engines, embedded, audio, …) `fk-scout` finds and vets community skills, plugins and MCP servers instead of the kit shipping a fixed pack. Adapted from [everything-claude-code](https://github.com/affaan-m/ECC) (MIT); see `THIRD_PARTY_NOTICES.md`.

## The rules that make it work
1. **Write everything to files.** Agents forget; files don't.
2. **Front-load your constraints.** A correction sent while an agent is working often arrives too late.
3. **Decisions become records (ADRs).** No re-arguing, and changes are explicit.
4. **Never self-approve.** A different agent reviews every plan, skill and change.
5. **Checks are code, not promises.** Each check is shown failing once before it counts, and is never loosened without your approval.
6. **Check what else is affected:** code (code graph) *and* everything else (legal texts, store listings, design, tests).
7. **Security in every task:** "What could a bad actor do here?" plus a test proving it's blocked.
8. **Nothing left running, no surprise bills:** label what you start, sweep by label, cap spend at the provider when you use paid cloud or API services.
9. **Log failures honestly.** That's where the method improves.

## What the guards are (and are not)
The kit's guards are **light**: regex-based speed bumps that stop an agent drifting from what was agreed (reading `.env`, writing a secret, loosening a check, an unapproved install, an unbudgeted deploy, skipping git hooks) and log it in the kit's own state folder outside the repo (`~/.fk/state/`). They never block OMC's workflow. They are not a sandbox and will not stop a determined attacker. Approvals count only when you type them yourself as the whole message (`fk-approve ...`, `fk-override ...`). `fk audit` summarizes what happened in plain words.

A false alarm on ordinary work is treated as a bug, so the checks are narrow on purpose:
- Only references to the kit itself count as tampering (its own hooks folder, a `founder-kit/.../hooks/` path, its state folder). Your own `src/hooks/...`, a `takeSnapshot()` helper or a commit message that names one are ordinary code. Anything heuristic can be passed with `fk-override gate-guard <reason>`; only feeding a hook event to the kit's dispatcher, setting `CLAUDE_PLUGIN_ROOT`, writing into the kit state folder and deleting or moving `.fk/` are hard stops.
- New config and CI files (a new workflow, `tsconfig.build.json`, `eslint.config.js`, `.prettierrc`) are the project setting itself up and pass, also when a scaffolder (`create-next-app`, `tsc --init`, `uv init`) writes them; edits to existing ones are checked. Values like `false`, `exclude`, `off`, `warn` count as loosening only on a strictness key (`strict`, `noImplicit*`, lint, test, check, coverage, ...) or when a rule that was `"error"` drops.
- Tightening and ordinary churn pass: rewriting a setting under the same key (`printWidth` 80 to 100, a rule from `"warn"` to `"error"`, more ruff rules), dependency and build sections of `pyproject.toml`, ignoring build output (`dist`, `coverage`, `node_modules`, lockfiles, generated code), per-file ignores for test paths, adding `workflow_dispatch` or restructuring `on:` while `push`/`pull_request` stay.
- Everyday setup passes: local-dev passwords in compose files (`POSTGRES_PASSWORD: "postgres"`), naming or loading `.env` (`echo ".env" >> .gitignore`, `--env-file .env`, `source .env`, `find . -name ".env*"`, `vercel env pull`), library installs into the project's environment (`pip install requests`, `uv pip install pytest`). Printing or copying `.env` is still stopped, and `--user`/global installs still need an approved, pinned version; `brew`/`winget`/`choco`/`scoop` have no version pins, so they are approved by name (`fk-approve tool brew:<name> <reason>`).
- In test folders and test files (`tests/`, `__tests__/`, `fixtures/`, `*.test.*`, `*.spec.*`, ...) made-up passwords and tokens pass; real key formats (AWS, GitHub, Stripe live, private keys, ...) are still stopped. The pre-commit gitleaks scan is the second line.

Known gaps, by design (the backstops are `fk audit`, session-bound approvals and after-the-fact checks):
- An approval line is recorded only by the hook Claude Code starts for the installed plugin (`CLAUDE_PLUGIN_ROOT`, which Claude Code exports to plugin hooks and not to Bash commands). An agent that copies the kit and fakes that variable in a shell the guard does not see could still write a record; `fk audit` lists every approval without a matching typed line from the plugin runtime, and every approval recorded from a folder other than the installed plugin's. A copy placed inside the plugin's own install folder is not told apart.
- A gate file changed by a shell command is caught after the fact (PostToolUse), not before. Only files whose size or time changed are re-hashed; in a large repo, new files are found through `git status`, so a new gate file that `.gitignore` hides is not reported there (the next session start simply adds it to the snapshot).
- Removing the kit state folder no longer launders a forged `.fk/` file: without a snapshot, only `.fk/` JSON files identical to the last commit are trusted. A forged file that was also committed is trusted on a fresh machine, which `fk audit` and code review are there to catch.
- If `.githooks/pre-commit` exists but git does not run it in this clone (`core.hooksPath` unset, or another hooks folder such as husky), the session start and `fk doctor` say so. `fk init` restores it and never replaces another hooks folder; `fk init --chain` adds the kit's pre-commit call to that folder instead.

## License
MIT (see `LICENSE`). Third-party notices: `THIRD_PARTY_NOTICES.md`.
