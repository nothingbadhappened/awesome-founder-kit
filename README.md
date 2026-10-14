# Founder Kit

Build a real product with AI agents when you are **not** a programmer. You decide *what* and *why*. The agents research, plan, build, check each other and keep records. Nothing is approved by the same agent that made it.

[oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) (OMC) runs the development workflow: planning, building, verifying and reviewing. The kit never replaces it. It adds what OMC does not do: the founder layer (idea, review, decisions, brand, journal), tool research and setup for any kind of project, light checks that the work follows what was agreed, and guards for secrets, spending and cleanup.

> Status: **v0.4**. The rules come from real projects, including the mistakes. Expect changes.

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
| 5. How work is done | `fk-process` + `fk-practice-*` packs | Project standards, gates and a short skill over OMC's workflow |
| 6. Look and voice | `fk-brand` | `design-system/` + a design skill |
| 7. Your to-do list | `fk-actions` | Accounts, key names, billing caps, approvals: one checklist |
| 8. Build | your project skill + OMC | The first task builds the safety checks themselves |

Already have a project? `fk-adopt` surveys it read-only, reconstructs the decisions, records today's quality as a baseline that may only improve, and leaves work in progress alone.

While building:
- **Conformance:** reviewers load `fk-conformance` and check each change against your decisions and standards; boundary rules become automatic checks.
- **Learning:** `fk-learn` records each failure once, counts repeats and turns repeated lessons into checks.
- **Stewardship:** `fk-steward` logs everything agents start, cleans up only this project's leftovers (`fk sweep`), and plans budget caps per provider (`fk budget plan`); providers with real hard caps are preferred.
- **Memory:** codebase-memory-mcp maps the code; MemPalace keeps history; decisions and lessons live in your repo files.

## Practice packs
Optional plugins with coding practice, loaded only when needed: `fk-practice-core` (standards, API design, architecture, errors, security checklist) and stack packs (web, python, go, jvm, apple, rust, php, llm, …). Adapted from [everything-claude-code](https://github.com/affaan-m/ECC) (MIT); see `THIRD_PARTY_NOTICES.md`.

## The rules that make it work
1. **Write everything to files.** Agents forget; files don't.
2. **Front-load your constraints.** A correction sent while an agent is working often arrives too late.
3. **Decisions become records (ADRs).** No re-arguing, and changes are explicit.
4. **Never self-approve.** A different agent reviews every plan, skill and change.
5. **Checks are code, not promises.** Each check is shown failing once before it counts, and is never loosened without your approval.
6. **Check what else is affected:** code (code graph) *and* everything else (legal texts, store listings, design, tests).
7. **Security in every task:** "What could a bad actor do here?" plus a test proving it's blocked.
8. **Nothing left running, no surprise bills:** label what you start, sweep by label, cap spend at the provider.
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
