---
name: fk-provision
description: "Use after the founder approves a toolchain proposal, or to undo an install: install exactly the approved tools, scanned and verified."
---

# Provision the approved toolchain

Installs only what the founder approved in `fk-approve proposal <id>`. `fk` = the kit CLI (if not found, use the path in the session's fk note).

## Steps
1. **Plan.** Run `fk provision <id> --dry-run`. If it says the proposal is not approved or changed after approval, stop and tell the founder in plain words; a change needs a delta proposal (`fk-scout`).
2. **Install.** Run `fk provision <id>`. For each approved entry it:
   - skips what is already there (its verify command passes);
   - scans skills and plugins with SkillSpector in quarantine and rejects them on findings;
   - runs the pinned install command for this computer, then the verify command;
   - adds approved MCP servers to the project `.mcp.json` and the MCP allowlist;
   - records each install with its rollback in `.fk/ledger.jsonl`;
   - adds env var names to `.env.example` and runs the environment checks.
3. **Report** to the founder in plain words: what was installed, what was already there, what needs them later (accounts, payments), and what is blocked. Blocked items are in `docs/process/BLOCKED.md` with options; ask about them with one AskUserQuestion.
4. **Restart note.** If MCP servers or skills were added, tell the founder Claude Code must be restarted to load them.

## Undo
- `fk provision rollback <name>` reverses the latest install of that item (uninstall command, `.mcp.json` entry, copied skill) and logs it.

## Don't
- Install anything that is not in the approved proposal, or a different version; ask for a delta proposal instead.
- Edit `.mcp.json`, `.claude/settings*.json` or `.fk/` by hand, or retry a rejected scan with the scan turned off.
- Treat a failed verify as done: it stays blocked until its check passes.
