---
name: fk-ai-regression-testing
description: Use after an AI agent changed backend/API code or fixed a bug, or when the same model wrote and reviewed a change - regression tests for AI blind spots, contract and multi-path parity tests.
---

# Regression testing for AI-written code

When one model writes and reviews a change, it carries the same assumptions into both steps. Automated tests break that loop; an independent reviewer (OMC's code-reviewer or verifier in a separate pass) helps, but a test that fails mechanically is the stronger check.

## Steps

1. **Run the mechanical checks first**: the project's test suite and build/type check. A failure is the top-priority finding and needs no judgment.
2. **For every bug found, write the failing test before the fix** (red), then fix (green). Name it after the bug (`"notification_settings present (BUG-R1 regression)"`) so it is obvious why it exists.
3. **Assert contracts, not implementation**: list the required fields of each API response and assert all are present with the right types (including nullable fields being present as `null`, not missing).
4. **Cover every code path that must stay in sync**: sandbox/mock vs production, feature-flag on vs off, cached vs uncached, web vs mobile serializers. Run the same contract assertions against each path.
5. **Review with the known blind spots in mind** (below), then add a regression test for each confirmed issue.
6. Keep these tests fast (no external services; use the project's sandbox/mock mode or in-process fakes) so they run on every change.

## Known AI blind spots to check

| Pattern | What goes wrong | Test |
|---|---|---|
| Path mismatch | New field added to the production path but not the sandbox/mock path (or vice versa) | Same required-field assertions on every path |
| Query omission | Field added to the response but not to the SELECT/`select`/`include` | Assert the field is present and populated |
| Generated types drift | Column added in SQL but not in generated types; a cast hides `undefined` | Assert not undefined; build/type check in CI |
| Stale state on error | Error shown while the previous data stays on screen | Assert related state cleared on failure |
| Optimistic update without rollback | UI removes an item, API fails, UI never restores it | Simulate API failure, assert previous state restored |
| Error handling only on the happy path | Partial writes without rollback | Inject a failure mid-operation, assert consistent state |

## Prioritising

- Start where bugs were found and where logic is complex (auth, money, multi-path code, state management); bugs cluster and AI repeats the same category of mistake.
- Coverage targets remain the project's decision; this practice adds targeted regression tests on top of them, it does not replace a normal test strategy.

## Rules

- AI self-review is never accepted as evidence that a bug is fixed; a passing test that failed before the fix is.
- Tests must fail for the right reason before the fix (verify the red step).
- Do not delete or weaken a regression test to make a change pass; if the contract genuinely changed, update the contract list deliberately and note why.

_Source: adapted from ECC `skills/ai-regression-testing` (MIT); see NOTICE.md._
