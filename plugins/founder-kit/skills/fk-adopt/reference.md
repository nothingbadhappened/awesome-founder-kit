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
| `PROJECT.md` | `docs/PROJECT.md` |
| `adr/*.md` | `docs/adr/` (or `paths.adr`) |
| `lessons.md` | `docs/process/lessons.md` |
| `impact-map.yaml` | `docs/standards/impact-map.yaml` |
| `standards/*.md` | `docs/standards/` (or `paths.standards`) |
| `knowledge-map.md` | `docs/process/knowledge-map.md` |

Drafts from `fk adopt knowledge compile` (lessons, standards, the knowledge map) are appended to an existing file under a `<!-- fk:knowledge appended ... review and merge -->` marker instead of being skipped; an existing `docs/PROJECT.md` is kept. `--annotate` (only after the founder's yes) adds one line to the top of each consolidated original, e.g. `> Consolidated on <date> (fk knowledge-map): §Vision superseded by ADR-0003.`; agent rule files, `.omc/` notes and memory are never touched.

Another git hooks path (husky) is kept by apply; to add the kit's pre-commit checks there, ask the founder, then `fk init --chain`.

`health.md` stays in the adopt workspace `drafts/` as the approval record.

Bible in index mode: per section up to 3 lines plus `Source of truth: <doc> §<section>`; apply records `bible_mode: index`.

`fk adopt apply` also runs `fk init`, records running containers as pre-existing in the ledger, records `.fk/baseline.json`, and adds the bible line to `CLAUDE.md` within its 40-line budget.

## Knowledge
What counts as knowledge: README files, `docs/**`, design/GDD/PRD/vision/spec/roadmap/wiki folders, ADR-like files under any name (adr, decision, rfc), agent rule files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules/**`, `.windsurfrules`, `.github/copilot-instructions.md`), OMC notes (`.omc/project-memory.json`, `notepad.md`, `wiki/`, read-only), this folder's Claude auto-memory (names and sizes stored; `type: user` memories are personal and never read), a MemPalace wing when the CLI is installed (searched read-only for this project's wing; `--skip mempalace` to avoid it), and plan folders.
- Kinds: bible, rules, architecture, decisions, lessons, plans, memory, other (file name, then section heading).
- Dates: per section and per statement from `git blame`; never-committed text has no date and is flagged.
- Caps: `knowledge.max_statements` (400) keeps rules, decisions and bible first, and records what was skipped; `knowledge.max_tokens` (150k) ranks groups by impact and leaves the least important out (listed in the report). Three quarters go to the analyst pass, the rest to the critic and the interview. Pass `--max-statements` / `--max-tokens`; once the kit is installed, `.fk/config.json` `knowledge` sets the defaults.
- Verdict format, one block per group: `cluster:`, `verdict: duplicate|contradiction|stale|ok`, `ids:`, `scope: same|different`, `why:` (one plain line). PowerShell: `@'...'@ | fk adopt knowledge verdict --by analyst`.
- Newer wins unless: a statement has no date, both have the same date, or the agent judged a different scope. Those, and all when the founder chose to review, are asked one by one.
- Resolutions: `latest`, `keep:S-n`, `both --note "<scope split>"`, `new --note "<wording>"`, `drop` (neither). Each resolved contradiction becomes an accepted ADR whose `supersedes:` names the source locations it replaces.
- Compile: bible (own mode; index mode with `--keep-sources` or when `bible_mode` is already index), ADRs for decisions, `docs/standards/<slot>.md` for rules, lessons from lessons and memory, and `docs/process/knowledge-map.md` (source § section -> destination, resolution ids, the consolidation date and commit).
- Afterwards `fk knowledge check` re-reads only the docs changed since that commit and pairs new statements with accepted ADRs, standards and bible lines: it flags likely contradictions (may miss differently-worded ones); `fk audit` and a weekly session note report the pairs for OMC's analyst to judge.

## Health report
One page, plain words, no jargon without a one-line explanation. Order:
1. One paragraph: what the product is and its overall state, and what the knowledge consolidation settled.
2. Risks, most serious first: security and secrets, then money (running or deployable resources with no cap), then missing tests on hotspots and fix-chain files, then structure. Each risk: what could happen, in one sentence, and what fixes it.
3. Tools to add or change (fk-scout delta), each with its reason.
4. What approval does: checks switch on with today's problems as the starting line; work in progress and running resources are left alone.
5. Remediation backlog: ranked `R2`/`R1` items, each small enough for one OMC task.

## Baseline ratchet
- `fk baseline record` stores one number per gate (`check`, `fast_gates`, or `--gate name=cmd`) plus the gitleaks history count.
- `fk baseline check` fails when a count goes up or coverage goes down; improvements become the new baseline (`--no-tighten` to only report).
- A gate whose output the CLI cannot count falls back to pass/fail (0 or 1).
