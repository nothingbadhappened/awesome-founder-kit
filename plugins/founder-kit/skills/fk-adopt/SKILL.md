---
name: fk-adopt
description: "Use when adopting an existing repo into the kit: read-only survey, reconstructed decisions, health report, baseline ratchet."
---

# Adopt a project already in progress

OMC owns the workflow; this skill only gathers facts, drafts, and installs the kit's layer. Never ask the founder a technical question; ask in plain words with AskUserQuestion. Budget: about 150k tokens for the whole adoption.

Until `fk adopt apply`, nothing in the repo changes: work lives in the kit state folder (`fk adopt where`), written only by the `fk` CLI. Save drafts with `fk adopt draft <name> --from <scratch file>`.

## A1 Survey (read-only)
1. Run `fk adopt survey`. Add `--run <name>=<command>` only for test, lint or build commands the project already defines. Never run anything that deploys, migrates, deletes or costs money.
2. Index the code: codebase-memory-mcp `index_repository` with the repo root.
3. With MemPalace (unless the founder said no memory), mine at most the printed cap of past sessions: `mempalace mine "<file>" --mode convos --wing <repo-slug>`.
4. Read `survey.md`; reference.md §Survey explains it.

## A2 Consolidate the project's own knowledge (reference.md §Knowledge)
5. Run `fk adopt knowledge inventory`, `extract`, then `candidates`.
6. For each work file `candidates` prints, launch OMC's `analyst`: read only that file, record verdicts with the one command it shows. Run `fk adopt knowledge report`; the second-look file it prints goes to the `critic` the same way; run `report` again.
7. Ask once: "<N> conflicts; the newer statement wins in each": accept all, review them, or review only the important ones. Record with `fk adopt knowledge resolve --all latest` (add `--minor` for the third answer).
8. Every conflict still open: one question each, 2–4 options: keep A, keep B, both with a scope split (propose the wording), or a new wording. Record with `fk adopt knowledge resolve <cluster> <keep:S-n|both|new> [--note "<wording>"]`.
9. Run `fk adopt knowledge compile --dry-run`, check the plan, then `compile`.

## A3 Reconstruct the rest (drafts only)
10. From the survey, the code (CBM `get_architecture`, `search_graph`) and the mined sessions, add what the docs did not say; edit the compiled drafts, never replace them:
   - `00-constraints.md`: product, users, red lines, budget (fk-kickoff part A).
   - `adr/NNNN-<slug>.md`: decisions visible in the code, `Status: reconstructed`, with `applies_to:` globs.
   - `PROJECT.md` (at most 60 lines, summaries that link) if A2 made none; `lessons.md` entries from reverts and fix chains.
   - `impact-map.yaml`: co-change pairs as impact rules.
11. One confirm-or-correct round with the founder (product facts only, at most 4 questions). Update the drafts.

## A4 Gap analysis and health report (one approval)
12. Load `fk-scout` as a delta against what the project uses. Keep existing `CLAUDE.md`, skills, hooks and MCP servers.
13. Run `fk adopt plan`. Rewrite `drafts/health.md` in plain words (reference.md §Health report), adding the knowledge report's summary, the fk-scout delta and `fk portability check` gaps; save it with `fk adopt draft health.md --from <file>`.
14. Show it; ask once: approve, or change something. Also ask whether to mark each consolidated original doc with one "consolidated into" line. Nothing installs without this yes.

## A5 Install with a baseline ratchet
15. Set the gate commands the project already has: `fk config set check "<command>"` (and `fast_gates`) after `fk init` if needed.
16. Run `fk adopt apply` (`--annotate` only after a yes in step 14; other git hooks paths: reference.md §Drafts). Agent rule files are never rewritten: offer the pointer section `compile` printed.
17. The first `fk baseline record` (done by `fk adopt apply`) needs no approval. Recording again (gates changed) needs the founder to type alone `fk-approve baseline <reason>`; then run `fk baseline record`. `fk baseline check` fails only on new problems.
18. Run `fk memory setup` to limit memory tools here.

## A6 Work in progress
19. Never commit, stash, reset or reformat uncommitted changes or branches. OMC's `.omc/` state continues as is. If hooks would affect uncommitted work, ask first.

## A7 Remediation backlog
20. Append the health report's backlog to OMC's plan or ultragoal ledger as separate R1/R2 items: security and money first, then tests on hotspots and fix-chain files, then structure. One item per task.
21. Tell the founder in two sentences what was installed and what comes next.
