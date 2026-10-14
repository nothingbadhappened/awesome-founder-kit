---
name: fk-coding-standards
description: Use when writing, reviewing or refactoring code and no stack-specific practice skill fits - naming, readability, KISS/DRY/YAGNI, error handling, code smells, test naming.
---

# Coding standards (cross-language floor)

The project's `docs/standards/` and accepted ADRs win over anything here. Use this as the default only where the project is silent. For stack detail, prefer the matching `fk-practice-*` skill.

## 1. Before writing

1. Read the project's standards and the neighbouring code; match its naming, layout, import style and error style.
2. Pick the simplest design that meets the requirement. No speculative options, flags or layers (YAGNI).
3. Reuse an existing helper before writing a new one; extract shared logic only on the second real duplicate (DRY without premature abstraction).

## 2. Naming

- Variables say what they hold: `marketSearchQuery`, not `q`; booleans read as questions: `isAuthenticated`, `hasAccess`.
- Functions are verb + noun: `fetchMarketData`, `calculateSimilarity`, `isValidEmail`.
- Named constants instead of magic numbers: `MAX_RETRIES = 3`, `DEBOUNCE_DELAY_MS = 500` (unit in the name).
- File names follow the stack's convention (e.g. `PascalCase` components, `useX` hooks, `snake_case.py`).

## 3. Readability

- Early returns instead of deep nesting; more than three levels is a smell.
- Functions do one thing; a function over ~50 lines or with many parameters usually hides a second responsibility.
- Comments explain *why* (a constraint, a trade-off, a workaround), never restate *what* the code does.
- Public APIs carry a short doc comment: purpose, parameters, errors raised.

## 4. Data and state

- Prefer returning new values over mutating shared or caller-owned data, unless the project's standards say otherwise or a measured hot path needs in-place mutation (say so in a comment).
- Model types precisely: unions/enums for closed sets, no `any`/untyped escape hatches without a reason.
- Run independent async work concurrently (`Promise.all`, `asyncio.gather`, goroutines + errgroup) instead of sequential awaits.

## 5. Errors

- Every caught error is handled, re-raised with context, or logged; never swallowed silently.
- User-facing messages are friendly and contain no internals; full context goes to server logs.
- See `fk-error-handling` for typed errors, retries and boundaries.

## 6. Tests

- Arrange / Act / Assert structure, one behaviour per test.
- Test names state the behaviour: "returns empty list when no market matches", not "works".
- Coverage target and test pyramid are project decisions (`docs/standards/`); do not invent a number.

## 7. Code smells to flag in review

| Smell | Fix |
|---|---|
| Long function / many params | Split by responsibility, pass a typed object |
| Deep nesting | Guard clauses, early return |
| Magic numbers / strings | Named constants |
| Copy-pasted blocks | Extract once the duplicate is real |
| Selecting/fetching everything | Select only needed fields, paginate |
| Dead code, commented-out code, debug prints | Delete |
| Clever one-liners | Rewrite for the reader |

## 8. Done check

- Matches existing patterns; lint, type check and tests pass with the project's commands.
- No debug output, TODO placeholders or unused code left behind.

_Source: adapted from ECC `skills/coding-standards` (MIT); see NOTICE.md._
