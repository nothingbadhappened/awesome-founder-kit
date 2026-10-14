---
name: fk-rust-testing
description: Use when writing or fixing Rust tests - unit and integration layout, Result-returning tests, async Tokio tests, rstest cases and fixtures, proptest, mockall, doc tests, criterion benchmarks, coverage.
---

# Rust testing

For test-first work OMC's `tdd` workflow drives the cycle (`todo!()` placeholders make the RED step compile). Coverage thresholds are the project's decision.

## Layout

- Unit tests in a `#[cfg(test)] mod tests { use super::*; ... }` at the bottom of each module (can reach private items).
- Integration tests in `tests/*.rs` (each file a separate binary, public API only); shared helpers in `tests/common/mod.rs`.
- Doc tests on public items double as examples; `no_run` for examples needing I/O.

## Writing tests

1. Name tests after behaviour: `rejects_invalid_email`, `creates_user_with_valid_email`.
2. `assert_eq!`/`assert_ne!` (better diffs than `assert!`), with a message where the values alone are unclear; floats with a tolerance.
3. Error paths: assert the variant with `matches!(err, ConfigError::Parse(_))`; return `Result<(), Box<dyn Error>>` from tests to use `?`.
4. Prefer testing `Result::is_err()` over `#[should_panic]`; when testing panics, use `#[should_panic(expected = "...")]`.
5. Small helper constructors (`make_user("alice")`) with sensible defaults; no shared mutable state between tests (tests run in parallel by default).

## Parameterized and property tests

- `rstest`: `#[rstest] #[case("hello", 5)] #[case("", 0)]` for tables; `#[fixture]` for reusable setup.
- `proptest!`: round-trips (`decode(encode(x)) == x`), invariants (sorting keeps length and order), custom strategies (`prop_map`) for valid domain inputs; commit regression files proptest writes.

## Async

- `#[tokio::test]` (with `flavor = "multi_thread"` when the code needs it).
- Control time with `tokio::time::pause()` + `advance()` instead of real sleeps; test timeouts via `tokio::time::timeout`.

## Mocking

- Depend on traits at boundaries (repositories, HTTP clients, clocks); hand-written fakes are often simplest.
- `mockall` (`#[automock]` on the trait): `expect_find_by_id().with(eq(42)).times(1).returning(|_| Some(user))`.
- HTTP: `wiremock` or `httpmock` servers; databases: real engine in integration tests (testcontainers or a CI service), `sqlx::test` where applicable.

## Benchmarks

- `criterion` in `benches/` with `harness = false`; wrap inputs in `black_box`; compare runs before and after a change.

## Coverage

`cargo llvm-cov` (`--html`, `--lcov`), adding `--fail-under-lines N` only with the project's agreed N; exclude generated code and FFI bindings.

## Commands

```bash
cargo test                       # all
cargo test name_fragment         # filter
cargo test --lib | --test api_test | --doc
cargo test -- --nocapture        # show output
cargo test --no-fail-fast
cargo test -- --ignored          # slow tests marked #[ignore]
```

CI: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, then coverage if tracked.

## Anti-patterns

- Mocking everything instead of integration-testing real components.
- `sleep` for synchronization; ignoring flaky tests.
- Skipping error-path tests; unwraps hiding which step failed (use `expect("context")` or `?`).

_Source: adapted from ECC `skills/rust-testing` (MIT); see NOTICE.md._
