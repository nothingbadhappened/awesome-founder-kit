# fk-start reference

## Status
Each step: date, link, `running`/`done`; background agents with their target file.
```
# Kickoff status
- [ ] 0 Base tools — fk setup, fk doctor → docs/process/toolkit.md
- [ ] 1 Record set up — drydock surfaces, CLAUDE.md, .gitignore, fk init, fk kickoff protect, fk memory setup
- [ ] 2 Idea imported — docs/00-source.md
- [ ] 3 Constraints + project shape — docs/00-constraints.md; fk kickoff release
- [ ] 4 Reviews — docs/01-business-review.md, docs/02-architecture.md   (agents: …)
- [ ] 5 Decisions — docs/adr/
- [ ] 5b Bible — docs/PROJECT.md (fk bible check), parent link if any
- [ ] 6 Tools — docs/research/, toolchain proposal approved, fk provision done
- [ ] 7 Dev process — docs/standards/*, .claude/skills/<project>-dev/
- [ ] 8 Brand — design-system/ (skip if no UI)
- [ ] 9 Founder actions + budgets — docs/process/founder-actions.md
- [ ] 10 Key facts — CLAUDE.md
- [ ] 11 First build task — docs/tasks/
```

## Bible
- Already have a vision doc, GDD or PRD? `fk bible init --index <doc>` makes `docs/PROJECT.md` a thin index of that doc instead.
- Part of a bigger project? Ask once in plain words; then `fk config set parent <folder or URL>` and name it under "Above this project".

## Protection
`fk kickoff protect` turns OMC's autopilot/ralph keywords off until the constraints exist. Record it as an ADR "kickoff protection, removed after constraints"; step 3 releases it (`fk kickoff release`) and marks that ADR superseded.

## Toolbox
List agent types, skills and MCP servers into `docs/process/toolkit.md`, then:
- **OMC (required; plugin mode preferred, an npm install is supported).** Check that `oh-my-claudecode:*` agents (planner, architect, critic, executor, verifier, code-reviewer, security-reviewer, test-engineer, designer) and skills (`omc-plan`, `execute`, `verify`, `omc-review`, `drydock`) are listed. Missing → run `fk setup` (it installs the plugin after one yes), or tell the founder to run `/plugin marketplace add Yeachan-Heo/oh-my-claudecode` and `/plugin install oh-my-claudecode@omc`, then restart. If OMC truly cannot be installed: brief a `general-purpose` agent with the role; never review in your own context.
- `fk setup` installs and verifies the base tools (OMC plugin, codebase-memory-mcp, MemPalace, SkillSpector, gitleaks, plus git, Node, uv). `fk doctor`: record its table. Red or yellow OMC version → ask the founder (AskUserQuestion) whether to update now; never update without a yes.
- **SkillSpector** (`skillspector --version`) scans third-party skills and MCP servers. Missing → record "skillspector: missing" and install nothing third-party (skill, plugin, MCP server) until it is present.
- **gitleaks** (`gitleaks version`) scans each commit for secrets (the kit's pre-commit hook runs it). Missing → offer to install a pinned version (step 9 rules).
- No code-graph tool (codebase-memory-mcp): use Grep; write "code-graph: unavailable" in task files.

## Pacing
Ask whether other projects share the account. Until a real limit is hit, assume a conservative limit (about 40% of the biggest past period); then record the observed number in `docs/process/toolkit.md` and keep a margin of 20% or more. Several strongest-model agents in parallel use limits fast.

Restarting the AI tool kills background agents; a second window in the same folder is safe.

## Machine check
Project-specific tools (runtimes, SDKs, engines, CLIs, MCP servers) come only through `fk-scout` → the founder's `fk-approve proposal <id>` → `fk-provision`. A single missing tool later: a delta proposal (`fk scout new --delta`), never a silent install.
