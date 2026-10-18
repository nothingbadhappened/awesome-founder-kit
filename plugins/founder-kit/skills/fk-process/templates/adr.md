---
applies_to: []  # e.g. [src/billing/**]: tasks there cite it, a first edit there is reminded of it. Project-wide decisions leave applies_to empty (the pointer already covers them); list only the folders this decision governs.
bible: []  # sections of docs/PROJECT.md this decision changes: mission|users|non-negotiables|principles|architecture (update them in the same task)
fit: []  # optional checks for fk gates build, one per line: - forbid_import: {from: "src/domain/**", to: "src/infra/**"} | - require_file: <path> | - forbid_path: <glob>
---
# NNNN — <Title>
Date: YYYY-MM-DD · Status: proposed | accepted (founder) | auto-decided, reversible | superseded by NNNN

## Context
## Decision
## Alternatives considered
- <Option> — why not
## Consequences
- Positive:
- Negative / risks:
- Follow-ups:
## Fitness gate
- Boundary or data rule this ADR sets → a `fit:` rule above (`fk gates build`), else a check in the project's check command (name it), or `GATE-MISSING: <rule>`.
