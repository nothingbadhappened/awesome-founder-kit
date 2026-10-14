# fk-adopt reference

## Survey
`survey.json` (in `fk adopt where`, outside the repo) fields and how to use them:
- `git.hotspots`: files changed most in the last 90 days. Where bugs and tests matter most; name them in the health report.
- `git.co_change`: file pairs changed together at least 3 times. Each pair is an impact-map candidate ("change A, check B").
- `git.reverts`, `git.fix_chains`: evidence of past failures. Each chain becomes one draft lesson (What happened = the chain's subjects, Lesson = what would have caught it). Use `fk lessons add` only after apply; before that, put them in the `lessons.md` draft.
- `gitleaks`: counts per rule, never values. Any count > 0 is an R2 security item: rotate the key first; rewriting history is a separate founder decision.
- `stack`: manifests, infrastructure files, CI, env var names (values are never read), existing AI setup to keep.
- `containers.related`: containers started from this repo's compose files. Apply records them as `pre_existing` in `.fk/ledger.jsonl`, so the sweep never stops them.
- `runs`: one number per command you passed with `--run` (problems, or coverage % for a name containing "cov").
- `sessions`: transcript files for this folder (name, size, date), newest first. Mining picks at most `suggested_cap`.

Re-run the survey with `--days N` or `--min-pair N` when the history is short or very busy; `--skip gitleaks,docker,sessions` skips parts.

## Drafts
`fk adopt apply` copies these from `drafts/` in the adopt workspace (`fk adopt where`), never over an existing or uncommitted file:

| Draft | Lands in |
|---|---|
| `00-constraints.md` | `docs/00-constraints.md` (or `paths.constraints`) |
| `adr/*.md` | `docs/adr/` (or `paths.adr`) |
| `lessons.md` | `docs/process/lessons.md` |
| `impact-map.yaml` | `docs/standards/impact-map.yaml` |

`health.md` stays in the adopt workspace `drafts/` as the approval record.

## Health report
One page, plain words, no jargon without a one-line explanation. Order:
1. One paragraph: what the product is and its overall state.
2. Risks, most serious first: security and secrets, then money (running or deployable resources with no cap), then missing tests on hotspots and fix-chain files, then structure. Each risk: what could happen, in one sentence, and what fixes it.
3. Tools to add or change (fk-scout delta), each with its reason.
4. What approval does: checks switch on with today's problems as the starting line; work in progress and running resources are left alone.
5. Remediation backlog: ranked `R2`/`R1` items, each small enough for one OMC task.

## Baseline ratchet
- `fk baseline record` stores one number per gate (`check`, `fast_gates`, or `--gate name=cmd`) plus the gitleaks history count.
- `fk baseline check` fails when a count goes up or coverage goes down; improvements become the new baseline (`--no-tighten` to only report).
- A gate whose output the CLI cannot count falls back to pass/fail (0 or 1).
