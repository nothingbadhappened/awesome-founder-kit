---
name: fk-golang-patterns
description: Use when writing or reviewing Go code - simplicity, error wrapping, interfaces, context, goroutines and leaks, graceful shutdown, package layout, functional options, performance and tooling.
---

# Go patterns

The project's `go.mod` Go version, linters (`.golangci.yml`) and standards win.

## Principles

- Clear over clever; return early, keep the happy path unindented.
- Make the zero value useful (`sync.Mutex`, `bytes.Buffer` work uninitialized; avoid nil maps that panic on write, or initialize them in a constructor).
- Accept interfaces, return concrete types.
- A little copying beats a little dependency.

## Errors

- Wrap with context and `%w`: `return nil, fmt.Errorf("load config %s: %w", path, err)`.
- Sentinel errors for expected conditions (`var ErrNotFound = errors.New("not found")`), typed errors (`*ValidationError`) when callers need fields; inspect with `errors.Is` / `errors.As`, never string matching.
- Never discard errors with `_` except documented best-effort cleanup.
- `panic` only for programmer errors at init; never for control flow or request handling.
- Handle each error once: either return it (wrapped) or log it, not both.

## Interfaces

- Small (one to three methods), defined in the consuming package, composed when needed.
- Optional behaviour via type assertion (`if f, ok := w.(Flusher); ok { ... }`).
- No interface "just in case": introduce it when a second implementation or a test fake needs it.

## Context and concurrency

- `ctx context.Context` is the first parameter of anything that does I/O or may block; never stored in structs.
- Every outbound call has a deadline (`context.WithTimeout` + `defer cancel()`, `http.NewRequestWithContext`); never use `http.DefaultClient` without timeouts in servers.
- Coordinated goroutines: `errgroup.WithContext` (bounded with `g.SetLimit(n)`); worker pools for fixed concurrency.
- Every goroutine has a clear exit: select on `ctx.Done()`, buffered result channels sized so senders never block forever, `close` by the sender only.
- Protect shared state with a mutex or confine it to one goroutine; run tests with `-race`.
- Graceful shutdown: on SIGINT/SIGTERM call `server.Shutdown(ctx)` with a timeout, then close resources.

## Packages and layout

- `cmd/<app>/main.go` wires dependencies; `internal/` for app code (`handler`, `service`, `repository`, `config`); `pkg/` only for code meant for external import.
- Package names short, lowercase, no underscores or stutter (`user.Service`, not `userservice.UserService`).
- No package-level mutable state or `init()` side effects (DB connections, env reads); inject dependencies through constructors (`NewServer(db *sql.DB)`).

## Structs

- Functional options (`NewServer(addr, WithTimeout(d), WithLogger(l))`) for constructors with several optional settings and sensible defaults.
- Embedding for composition, not to fake inheritance; be aware embedded methods become part of the API.
- Consistent receiver kind per type (pointer receivers if any method mutates).
- Avoid naked returns except in very short functions.

## Performance (after profiling with pprof/benchmarks)

- Preallocate slices/maps when size is known: `make([]T, 0, n)`.
- `strings.Builder` / `strings.Join` instead of `+=` in loops.
- `sync.Pool` for hot, short-lived allocations (reset before `Put`).
- Avoid unnecessary conversions between `[]byte` and `string` in hot paths.

## Tooling

- `gofmt`/`goimports` always; `go vet ./...`; `staticcheck` or `golangci-lint run` (errcheck, govet incl. shadow, staticcheck, unused, ineffassign, misspell).
- `go mod tidy` and `go mod verify` in CI; `govulncheck ./...` for known vulnerabilities.
- `go test -race ./...` in CI (see `fk-golang-testing`).

## Review checklist

- [ ] Errors wrapped with context, checked with `errors.Is/As`, none ignored
- [ ] Context first, deadlines on I/O, no context in structs
- [ ] Goroutines cannot leak; shared state synchronized; race detector clean
- [ ] Interfaces small and consumer-owned; constructors inject dependencies
- [ ] No global mutable state; graceful shutdown in servers
- [ ] gofmt, vet, linters clean

_Source: adapted from ECC `skills/golang-patterns` (MIT); see NOTICE.md._
