---
name: fk-rust-patterns
description: Use when writing or reviewing Rust code - ownership and borrowing, Result/? errors, enums and exhaustive matching, traits and generics, newtypes, concurrency and async, unsafe, crate layout.
---

# Rust patterns

The project's edition, MSRV, clippy config and standards win.

## Ownership

- Borrow (`&T`, `&mut T`, `&str`, `&[T]`) unless the function stores or consumes the value; take ownership only then.
- Do not `.clone()` to silence the borrow checker; restructure scopes or borrow instead. Clone deliberately where it is cheap or required (and say why for large values).
- `Cow<'_, str>` when a function sometimes needs to allocate and usually does not.
- Accept `impl AsRef<str>`/`impl Into<String>` at API edges where it helps callers.

## Errors

- Fallible functions return `Result`; propagate with `?`.
- Libraries: typed error enums with `thiserror` (`#[error("record not found: {id}")]`, `#[from]` conversions). Applications: `anyhow::Result` with `.context(...)`/`.with_context(|| ...)` and `bail!`.
- No `unwrap()`/`expect()` on paths that can fail at runtime in production code; `expect("reason")` only for true invariants, with the invariant in the message. Tests may unwrap.
- `Option` combinators (`map`, `and_then`, `ok_or_else`, `?` on Option) instead of nested `match`.
- Mark important return values `#[must_use]`; never `let _ =` a `Result` without a comment.

## Types and matching

- Make illegal states unrepresentable: enums with data per state (`Connecting { attempt }`, `Connected { session_id }`).
- Exhaustive `match` on business enums, no `_` wildcard, so new variants fail compilation where they matter.
- Newtypes (`struct UserId(u64)`) for ids and units to prevent argument swaps; parse, don't validate: convert raw input into typed structs at the boundary (serde + validation).
- Builder pattern (or `Default` + struct update) for types with many optional fields.

## Traits and generics

- Generic inputs (`impl Read`, `T: Display + Send + 'static`) and concrete return types.
- Static dispatch (generics) by default for performance; `Box<dyn Trait>` / `&dyn Trait` for heterogeneous collections and plugin points (`Send + Sync` bounds when shared across threads).
- Small, focused traits; implement standard traits (`Debug`, `Clone`, `PartialEq`, `Display`, `From`) where they make sense.

## Iterators

- Iterator chains (`filter`, `map`, `collect::<Vec<_>>()`) over manual push loops; collect `Result`s with `collect::<Result<Vec<_>, _>>()` to short-circuit on the first error.
- Avoid intermediate `collect` calls in hot paths.

## Concurrency

- Threads: share with `Arc<Mutex<T>>`/`Arc<RwLock<T>>` (keep lock scopes short, never hold a std lock across `.await`), or pass messages over bounded channels for backpressure.
- Async (Tokio): never block the executor (`std::thread::sleep`, blocking I/O, heavy CPU) - use `tokio::time::sleep`, async I/O, `spawn_blocking`.
- Every network call has a timeout (`tokio::time::timeout` or client config); handle `JoinError` from spawned tasks instead of panicking; prefer `JoinSet` / structured joins and cancellation via `CancellationToken`.

## Unsafe

- Only at FFI boundaries or measured hot paths, encapsulated behind a safe API.
- Every `unsafe` block has a `// SAFETY:` comment stating the invariant; every `unsafe fn` documents `# Safety` for callers.
- Never to bypass the borrow checker, for convenience, or to transmute unrelated types. Run Miri on unsafe-heavy code.

## Crate layout

- Modules by domain (`auth/`, `orders/`), infrastructure separate (`db/`); `lib.rs` holds logic, `main.rs` stays thin.
- Minimal public surface: private by default, `pub(crate)` for internal sharing, re-export the public API from `lib.rs`.
- Workspaces for multi-crate projects with shared dependency versions.

## Tooling

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo doc`.
- `cargo audit` (or `cargo deny`) in CI for advisories and licenses; `Cargo.lock` committed for binaries.

## Review checklist

- [ ] No needless clones; borrows where ownership is not needed
- [ ] `Result` + `?` with context; no runtime unwraps
- [ ] Exhaustive matches on domain enums; newtypes for ids
- [ ] No blocking in async; timeouts on I/O; locks not held across await
- [ ] `unsafe` justified with SAFETY comments
- [ ] fmt, clippy (deny warnings), audit clean

_Source: adapted from ECC `skills/rust-patterns` (MIT); see NOTICE.md._
