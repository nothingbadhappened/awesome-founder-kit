---
name: fk-adopt
description: "Use when adopting an existing repo into the kit: read-only survey, reconstructed decisions, health report, baseline ratchet."
---

# Adopt a project already in progress

OMC owns the workflow; this skill only gathers facts, drafts, and installs the kit's layer. Never ask the founder a technical question. Budget: about 150k tokens for the whole adoption.

Until `fk adopt apply`, nothing in the repo changes: the survey and drafts live in the kit state folder outside the repo (`fk adopt where` prints it). Files under `.fk/` change only through the `fk` CLI. Write drafts to a scratch file, then `fk adopt draft <name> --from <file>`.

## A1 Survey (read-only)
1. Run `fk adopt survey`. Add `--run <name>=<command>` only for test, lint or build commands the project already defines (package scripts, Makefile, CI steps you read). Never guess or run anything that deploys, migrates, deletes or costs money.
2. Index the code: call the codebase-memory-mcp tool `index_repository` with the repo root.
3. Past sessions: the survey prints this folder's Claude transcripts, newest first. If MemPalace is installed, mine at most the printed cap (default 10; prefer recent, then large) with `mempalace mine "<file>" --mode convos --wing <repo-slug>`. Skip if the founder said no memory.
4. Read the `survey.md` the survey printed (in `fk adopt where`). Load reference.md §Survey for how to read hotspots, co-change pairs and fix chains.

## A2 Reconstruct intent (drafts only)
5. From the survey, the code (CBM `get_architecture`, `search_graph`) and the mined sessions, draft:
   - `00-constraints.md`: what the product is, for whom, red lines, budget (same shape as fk-kickoff part A).
   - `adr/NNNN-<slug>.md`: one per decision already visible in the code, `Status: reconstructed` (fk-process ADR template).
   - `lessons.md`: entries from reverts and fix chains (fk-process lessons template).
   - `impact-map.yaml`: co-change pairs as impact rules.
   Save each with `fk adopt draft <name> --from <scratch file>`.
6. One confirm-or-correct round with the founder (AskUserQuestion, product facts only, at most 4 questions). Update the drafts.

## A3 Gap analysis
7. Load `fk-scout` and run it as a delta against what the project already uses. Keep existing `CLAUDE.md`, skills, hooks and MCP servers.

## A4 Health report (one approval)
8. Run `fk adopt plan`. Rewrite `drafts/health.md` (in `fk adopt where`) in plain words using reference.md §Health report, add the fk-scout tool delta, save it with `fk adopt draft health.md --from <file>`.
9. Show it to the founder; ask once (AskUserQuestion): approve, or change something. Nothing installs without this yes.

## A5 Install with a baseline ratchet
10. Set the gate commands the project already has: `fk config set check "<command>"` (and `fast_gates`) after `fk init` if needed.
11. Run `fk adopt apply`. It runs `fk init` (another git hooks path, such as husky, is kept; to add the kit's pre-commit checks there, ask the founder, then `fk init --chain`), copies confirmed drafts into `docs/` without overwriting anything, records running containers as pre-existing in the ledger, and records `.fk/baseline.json`.
12. If the gates changed after apply, run `fk baseline record` again. From now on `fk baseline check` fails only on new problems; improvements are locked in.
13. Run `fk memory setup` to limit memory tools for this project.

## A6 Work in progress
14. Never commit, stash, reset or reformat existing uncommitted changes or branches. OMC's `.omc/` state continues as is. If installing hooks would affect uncommitted work, ask first.

## A7 Remediation backlog
15. Append the health report's backlog to OMC's current plan or ultragoal ledger as separate R1/R2 items: security and money first, then tests on hotspots and fix-chain files, then structure. One item per task, through the normal OMC flow; never one big refactor.
16. Tell the founder in two sentences what was installed and what happens next.
