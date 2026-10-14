---
name: fk-golang-testing
description: Use when writing or fixing Go tests - table-driven subtests, helpers and cleanup, golden files, interface fakes, httptest handlers, benchmarks, fuzzing, race detection and coverage.
---

# Go testing

Standard library `testing` first; assertion libraries (testify, go-cmp) only if the project already uses them. Coverage gates are the project's decision. For test-first work OMC's `tdd` workflow drives the cycle.

## Writing tests

1. **Table-driven** by default: a slice of `struct{ name string; in ...; want ...; wantErr bool }`, looped with `t.Run(tt.name, ...)`.
2. Error cases in the same table; on `wantErr` assert the error (with `errors.Is` for sentinel errors) and return.
3. Compare structs with `reflect.DeepEqual` or `cmp.Diff(want, got)` (clearer diffs); messages read `Func(args) = got; want want`.
4. `t.Fatalf` when the test cannot continue, `t.Errorf` to keep collecting failures.
5. `t.Parallel()` in independent tests and subtests (on Go < 1.22 capture the loop variable `tt := tt`).

## Helpers and resources

- Helpers call `t.Helper()` so failures point at the caller.
- `t.Cleanup(func(){...})` instead of manual defers in helpers; `t.TempDir()` for files; `t.Setenv` for env vars.
- Test fixtures in `testdata/` (ignored by the go tool).

## Golden files

Compare output with `testdata/<name>.golden`; regenerate with a `-update` flag (`var update = flag.Bool("update", false, "update golden files")`), and review golden diffs like code.

## Fakes and mocks

- Depend on small interfaces; write hand-rolled fakes (struct with function fields or in-memory maps) in the test package.
- Use generated mocks (mockgen, moq) only when the project already does; exclude generated code from coverage.
- Prefer real dependencies in integration tests (testcontainers or a CI service for Postgres/Redis), guarded by `testing.Short()` or build tags so `go test -short` stays fast.

## HTTP

- Handlers: `httptest.NewRequest` + `httptest.NewRecorder`, call `ServeHTTP`, assert status, headers and body; table of method/path/body/wantStatus.
- Clients: `httptest.NewServer` returning canned responses, including errors and slow responses (with context timeouts).

## Benchmarks and fuzzing

- `func BenchmarkX(b *testing.B)`: build input, `b.ResetTimer()`, loop `b.N` (or `for b.Loop()` on Go 1.24+); sub-benchmarks per input size; run `go test -bench=. -benchmem`; compare with `benchstat`.
- `func FuzzX(f *testing.F)`: seed with `f.Add(...)`, assert properties (round-trip, no panic, symmetry) in `f.Fuzz`; run `go test -fuzz=FuzzX -fuzztime=30s`; commit crashers from `testdata/fuzz/` as regression cases.

## Flakiness

- No `time.Sleep` synchronization; use channels, `sync.WaitGroup`, or polling with a deadline; inject clocks.
- Detect with `go test -count=10 -race -run TestX ./pkg`.

## Commands

```bash
go test ./...                         # all
go test -run 'TestUser/Create' ./...  # one subtest
go test -race -coverprofile=coverage.out ./...
go tool cover -func=coverage.out      # per-function coverage
go test -short -timeout 60s ./...
```

## Anti-patterns

- Testing unexported helpers instead of the package's behaviour (use `package x_test` for black-box tests).
- Mocking everything; skipping error paths; ignoring flaky tests.
- Shared global state between tests that run in parallel.

_Source: adapted from ECC `skills/golang-testing` (MIT); see NOTICE.md._
