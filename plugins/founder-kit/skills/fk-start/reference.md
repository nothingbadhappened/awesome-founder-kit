# fk-start reference

## Status
```
# Kickoff status
- [ ] 0 Toolbox check (OMC, SkillSpector, gitleaks) — docs/process/toolkit.md
- [ ] 1 Record set up — drydock surfaces, CLAUDE.md, .gitignore, fk init, fk kickoff protect
- [ ] 2 Idea imported — docs/00-source.md
- [ ] 3 Constraints + project shape — docs/00-constraints.md; fk kickoff release
- [ ] 4 Reviews — docs/01-business-review.md, docs/02-architecture.md   (agents: …)
- [ ] 5 Decisions — docs/adr/
- [ ] 6 Dev process — docs/standards/*, .claude/skills/<project>-dev/
- [ ] 7 Brand — design-system/ (skip if no UI)
- [ ] 8 Key facts — CLAUDE.md
- [ ] 9 Machine check — docs/process/toolkit.md
- [ ] 10 First build task — docs/tasks/
```

## Toolbox
List agent types, skills and MCP servers into `docs/process/toolkit.md`, then:
- **OMC (required, plugin mode).** Check that `oh-my-claudecode:*` agents (planner, architect, critic, executor, verifier, code-reviewer, security-reviewer, test-engineer, designer) and skills (`omc-plan`, `execute`, `verify`, `omc-review`, `drydock`) are listed. Missing → tell the founder to run `/plugin marketplace add Yeachan-Heo/oh-my-claudecode` and `/plugin install oh-my-claudecode@omc`, then restart. If OMC truly cannot be installed: brief a `general-purpose` agent with the role; never review in your own context.
- `fk doctor`: record its table. Red or yellow OMC version → ask the founder (AskUserQuestion) whether to update now; never update without a yes.
- **SkillSpector** (`skillspector --version`) scans third-party skills and MCP servers. Missing → record "skillspector: missing" and install nothing third-party (skill, plugin, MCP server) until it is present.
- **gitleaks** (`gitleaks version`) scans each commit for secrets (the kit's pre-commit hook runs it). Missing → offer to install a pinned version (step 9 rules).
- No code-graph tool (codebase-memory-mcp): use Grep; write "code-graph: unavailable" in task files.

## Pacing
Ask whether other projects share the account. Until a real limit is hit, assume a conservative limit (about 40% of the biggest past period); then record the observed number in `docs/process/toolkit.md` and keep a margin of 20% or more. Several strongest-model agents in parallel use limits fast.

Restarting the AI tool kills background agents; a second window in the same folder is safe.

## Machine check
1. Check each tool the architecture needs (runtimes, Docker, package manager, command runner, gitleaks) with `--version`.
2. For each missing one, ask with AskUserQuestion: its purpose in one line, the exact pinned version, the install route (official installer, winget/brew, or project-local).
3. On a yes, show the founder the line to paste, for example `fk-approve tool pnpm@9.1.0 package manager for this project`. Install only after it is recorded (the hook confirms it); the first approval turns the install guard from log-only to enforcing.
4. Record versions in `toolkit.md`.
