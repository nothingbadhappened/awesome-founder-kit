# Founder Kit (v0.3)

A method for building a real product with AI agents when you are **not** a programmer. You decide *what* and *why*. The agents plan, build, check each other and keep records. Nothing is approved by the same agent that made it.

oh-my-claudecode (OMC) runs the development workflow: planning, building, verifying and reviewing. The kit never replaces it. It adds the founder layer (idea, review, decisions, brand, journal) and makes sure the work follows what was agreed (decisions, standards, architecture).

> Status: **v0.3**. The rules come from real projects, including the mistakes. Expect changes.

## What you need
- Claude Code (terminal or desktop) with a subscription. claude.ai and Cowork do not install plugins that ship a `bin/` folder, which the kit's `fk` command needs.
- **oh-my-claudecode as a plugin (required).** The kit declares it as a dependency, so installing the kit installs it. It provides the agents (analyst, architect, critic, executor, verifier, reviewers, designer) and the workflow skills (plan, execute, verify, review, drydock).
- Recommended: codebase-memory-mcp (shows what code depends on what), NVIDIA SkillSpector (scans third-party skills and MCP servers before install) and gitleaks (scans each commit for secrets).
- Optional: MemPalace for long-term memory, and any generation or tool MCPs your product needs.

## Install (in any project)
In Claude Code, inside your new project:
```
/plugin marketplace add Yeachan-Heo/oh-my-claudecode   # OMC's marketplace ("omc"), needed for the dependency
/plugin marketplace add nothingbadhappened/awesome-founder-kit
/plugin install founder-kit@awesome-founder-kit
```
Restart Claude Code, then say: **"Start my project with fk-start."**

## How to start
1. Create an empty folder for your project and open Claude Code in it.
2. Install the kit (above).
3. Say: **"Start my project with fk-start."**

The kit then guides you through:

| Step | Skill | You get |
|---|---|---|
| 1. Bring your idea in | `fk-idea-import` | `docs/00-source.md`: your brainstorm, in full |
| 2. Say what's non-negotiable | `fk-kickoff` (interview) | Market, platforms, red lines, budget, written down |
| 3. Honest review + technical plan | `fk-kickoff` (OMC agents) | `docs/01-business-review.md`, `docs/02-architecture.md` |
| 4. Decide | `fk-kickoff` (decisions) | `docs/adr/*.md`: one file per decision |
| 5. How work will be done | `fk-process` | `docs/standards/*` and a short project skill over OMC's workflow |
| 6. How it will look and sound | `fk-brand` | `design-system/` + a design skill |
| 7. Keep the story | `fk-journal` | `docs/process/`: journal, lessons, toolkit, playbook |
| 8. Build | your project skill + OMC | The first task builds the safety checks themselves (bootstrap) |

Reviewers also load `fk-conformance`, which checks every change against your decisions and standards.

## The rules that make it work
1. **Write everything to files.** Agents forget; files don't.
2. **Front-load your constraints.** A correction sent while an agent is already working often arrives too late.
3. **Decisions become records (ADRs).** No re-arguing, and changes are explicit.
4. **Never self-approve.** A different agent reviews every plan, skill and change.
5. **Checks are code, not promises.** Each safety check is shown failing once before it counts, and is never loosened without your approval.
6. **Check what else is affected:** code (code graph) *and* everything else (an impact map: legal texts, store listings, design, tests).
7. **Security in every task:** "What could a bad actor do here?" plus a test proving it's blocked.
8. **Same thing locally and in the cloud,** with fake providers so it works offline.
9. **Log failures honestly.** That's where the method improves.

## What the guards are (and are not)
The kit's guards are **light**: regex-based speed bumps that stop an agent drifting from what was agreed (reading `.env`, loosening a gate, an unpinned install, an unbudgeted deploy) and log it in `.fk/compliance.jsonl`. They are not a sandbox and will not stop a determined attacker. Approvals count only when you type them yourself as the whole message (`fk-approve ...`, `fk-override ...`).

## License
License: MIT (see `LICENSE`).
