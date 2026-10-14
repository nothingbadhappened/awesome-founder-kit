---
name: fk-verification-reference
description: Use during OMC verify or before claiming a change is done or opening a PR - which checks to run (build, types, lint, tests, security grep, diff review) and how to report them.
---

# Verification reference

Reference material for OMC's `verify` workflow and verifier agent; it does not replace them. Use the project's own commands (`docs/standards/`, package scripts, Makefile, CI config); the examples below are fallbacks.

## Phases (stop at the first hard failure and fix it)

1. **Build** - the project's build command (`npm run build`, `cargo build`, `go build ./...`, `./gradlew build`, ...). A failing build ends verification.
2. **Types** - `tsc --noEmit` (local binary, no network install), `pyright`/`mypy`, compiler warnings as errors where the project enables it. Report every error; fix before continuing.
3. **Lint/format** - the configured linters (`eslint`, `ruff`, `golangci-lint`, `clippy -D warnings`, ...) in check mode.
4. **Tests** - the full relevant suite, fresh run; report total/passed/failed/skipped. Coverage is checked against the project's own threshold if it has one; do not invent a number.
5. **Security scan** - grep the diff for secrets (`sk-`, `api_key`, `password=`, private keys), debug output (`console.log`, `print(`, `dbg!`), and disabled checks (`.skip`, `.only`, `@Disabled`, `# noqa` added without reason). Run the project's secret scanner/dependency audit if configured.
6. **Diff review** - `git diff --stat` and the full diff: unintended files, missing error handling, edge cases, leftover TODO/placeholder code, tests weakened to pass.

## Evidence rules

- Only fresh output counts; never report a result you did not run in this state of the code.
- Quote the command and the summary line (e.g. `42 passed, 0 failed`).
- A skipped phase is reported as SKIPPED with the reason, never as PASS.

## Report format

```
VERIFICATION REPORT
Build:    PASS | FAIL
Types:    PASS | FAIL (N errors)
Lint:     PASS | FAIL (N warnings)
Tests:    PASS | FAIL (X/Y passed, coverage Z% vs project threshold)
Security: PASS | FAIL (N issues)
Diff:     N files changed, unintended changes: none | list
Overall:  READY | NOT READY
Issues to fix:
1. ...
```

## When to run

After each completed unit of work (function, component, endpoint), after refactors, before a PR, and before telling anyone the task is done. Hooks catch problems per edit; this pass checks the whole change.

_Source: adapted from ECC `skills/verification-loop` (MIT) as reference for OMC verify; see NOTICE.md._
