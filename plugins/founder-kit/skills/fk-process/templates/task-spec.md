---
id: {{id}}
title: {{title}}
risk: {{risk}}
created: {{date}}
omc: {{omc}}
acceptance:
{{acceptance}}
---
# {{title}}
UI: yes|no · Review status: reviewed | early-unreviewed

Created by `fk task new`; closed by `fk task done {{id}}`. Each `AC-n` is one checkable statement. Reviewers write `docs/tasks/{{id}}.review-<n>.md` (format: fk-conformance). Only what OMC's plan does not hold goes below. An `early-unreviewed` task may not be called done.

## Impact acknowledgements (impact-map.yaml + code-graph or Grep)
| Rule / symbol | Updated / Not affected because… |
|---|---|

## Blast radius (unchanged / extended / breaking)
| Module / interface / data | Dependents | Status | Migration path |
|---|---|---|---|

## Threat model (R2/R3 or entry points; docs/standards/security.md §1)
- Assets / entry points:
- STRIDE (threat → control, or n/a because…):
- Negative tests:

## Rollback
- Previous version safe to redeploy? (y/n + why):
- Disabling flag / data repair:

## Gates
- GATE-MISSING / GATE-BLOCKED:
- Planted-violation proofs (command, quoted failure):

## Founder actions
| Decision or approval needed | Status | Approval line (`founder YYYY-MM-DD`) |
|---|---|---|

## Evidence and review
- `<runner> check` / `e2e` / `eval`:
- `fk task check {{id}}`:

## Follow-ups
