---
name: fk-adr-writing
description: Use when a significant technical choice is made or questioned ("record this decision", "why did we pick X?", framework/database/pattern trade-offs) - write or read ADRs in docs/adr/.
---

# Writing and reading ADRs

An ADR records one decision, its context, the options rejected and the consequences, so later agents and people do not reopen it blindly.

## Format

Use the project's template if one exists (`docs/adr/template.md`, or the founder-kit `fk-process` ADR template). Otherwise:

```markdown
# NNNN - <Decision title>
Date: YYYY-MM-DD · Status: proposed | accepted | deprecated | superseded by NNNN

## Context
2-5 sentences: the problem, constraints, forces.
## Decision
1-3 sentences, present tense ("We use X").
## Alternatives considered
- <Option> - why not (a specific reason, never "we just picked it")
## Consequences
- Positive:
- Negative / risks (with mitigation):
- Follow-ups:
## Fitness gate
- Rule this ADR sets -> the automated check that enforces it, or `GATE-MISSING: <rule>`.
```

## Recording a decision

1. Detect the moment: an explicit "let's go with X / record this", or an implicit one (two options compared and one chosen; schema, auth, deployment or architecture style decided). For implicit ones, suggest an ADR; do not write it unasked.
2. If `docs/adr/` does not exist, ask before creating it with a `README.md` index.
3. Gather context, the decision, at least one real rejected alternative, and honest consequences. Keep it readable in two minutes; Context over ~10 lines is too long.
4. Number it: next free `NNNN` in `docs/adr/`; file `docs/adr/NNNN-<kebab-slug>.md`.
5. Show the draft and write it only after approval; status `proposed` until the decision owner accepts it.
6. Append a row to `docs/adr/README.md`: `| [NNNN](NNNN-slug.md) | Title | status | date |`.
7. If it replaces an earlier ADR, set the old one to `superseded by NNNN` and link back. Never edit an accepted ADR's decision in place.
8. Name the fitness gate (lint rule, dependency check, test) that keeps code aligned, or mark it `GATE-MISSING`.
9. Backfilled past decisions keep their original date and say so.

## Reading ADRs ("why do we do X?")

1. Scan `docs/adr/README.md` (or file names) for the topic.
2. Read the matching ADR; the latest accepted one wins over older or superseded ones.
3. Answer from its Context and Decision; if none exists, say so and offer to record one.
4. A change that contradicts an accepted ADR stops for the decision owner; it proceeds only through a superseding ADR.

## Worth an ADR

Technology choices (language, framework, database, cloud); architecture style (monolith vs services, events, CQRS); API style, versioning, auth mechanism; data model and caching strategy; deployment, CI/CD, observability; security approach and secret handling; test strategy and coverage targets; branching and release process.

Not worth one: formatting, local naming, choices any reviewer would make the same way.

_Source: adapted from ECC `skills/architecture-decision-records` (MIT), merged with the founder-kit ADR template; see NOTICE.md._
