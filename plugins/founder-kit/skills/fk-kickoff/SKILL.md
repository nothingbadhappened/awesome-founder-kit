---
name: fk-kickoff
description: "Use after fk-idea-import or for a fresh honest review: non-negotiables interview, OMC business and architecture reviews, ADRs."
---

# Kickoff Review

## Part A: non-negotiables (never skip)
AskUserQuestion, 2–4 questions per call, recommended option first. Save to `docs/00-constraints.md`:
- Who/where: users, geography (excluded markets), languages.
- Launch platforms, with timing: web, iOS, Android, desktop, API.
- Red lines: content, data, users (e.g. minors), regulations.
- Money: how users pay; validation budget; monthly idle infra budget.
- Must-have integrations (stores, payments, existing accounts).
- Team/time: solo + agents? weekly hours? deadlines?
- Existing assets: brand, domain, accounts, code.
- Work judged by eye or ear (media, copy, design): how many attempts before the agent checks back (2 / 3 / 5)? Record it in `00-constraints.md`; to enforce a value other than 3, the founder types `fk-approve rounds <n>`.
- Project shape: (a) no software; (b) static/marketing site; (c) web app with accounts/data; (d) (c) + native mobile; (e) any + AI/ML.

**Business rules.** Write every rule the product must always keep (red lines, money, data, users, legal) as a numbered line in `00-constraints.md`: `- BR-n: <rule, one checkable statement>. Check: <how a reviewer or a test tells>. Why: <one clause>.` Never renumber; a dropped rule keeps its number as `- BR-n (retired): …`, a proposed one not yet confirmed is `- BR-n (draft): …` (neither is checked). Reviewers answer the rules a change can touch (`fk-conformance`; every rule from risk R2), and `fk task check` fails on a `BR-n: VIOLATION` from R1. Only the founder retires a rule; retiring one during an open task fails that task's check. A rule that a test can check also becomes a test in the project's own check command.

**Hard stop:** no analyst or architect agent starts until market, platforms and must-have integrations are written in `00-constraints.md`.

## Part B: parallel reviews
Write each agent's role and target file into `docs/process/kickoff-status.md` as `running`. Launch both as background agents in one message. Briefs: reference.md §Briefs.
1. `oh-my-claudecode:analyst` (business review). Inputs: `00-source.md`, `00-constraints.md`.
2. `oh-my-claudecode:architect`. Same inputs plus existing `docs/standards/*` and ADRs.

A new founder constraint goes to **both** agents immediately and is noted. Agent already finished → merge by hand or request a v2.

Reconcile:
- Save `docs/01-business-review.md`, `docs/02-architecture.md`.
- List their conflicts; each becomes an open decision in Part C.
- Two versions of a doc: keep one canonical, archive the other with a pointer.
- `oh-my-claudecode:verifier` (never yourself) checks consistency, broken section references, contradictions with `00-constraints.md`; fix its findings.

## Part C: decisions
- AskUserQuestion per open decision: recommendation first, consequence of each option.
- Record each as `docs/adr/NNNN-<slug>.md` from `fk-process` `templates/adr.md`, status "accepted (founder)"; mark a replaced ADR "superseded by". A choice the founder delegated is `auto-decided, reversible`.
- Provider terms: list every AI or storage provider that will see user data, with its data-terms status (verified / unknown) in `docs/02-architecture.md`. Unknown → that provider is limited to testing with synthetic data.
- Add a "Founder decisions" block atop `docs/02-architecture.md` linking the ADRs.
- Journal entry (`fk-journal`): what was decided and the questions behind it.

## Quality bar
Prices and rankings carry date and source; unconfirmed → "(verify)". Founder anecdotes are labelled as anecdotes, never evidence.
