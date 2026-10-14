---
name: fk-kotlin-patterns
description: Use when writing or reviewing Kotlin code - null safety, immutability, data/value/sealed types, scope functions, extensions, delegation, DSLs, collections, Result/require, Gradle Kotlin DSL.
---

# Kotlin patterns

The project's Kotlin version, detekt/ktlint config and standards win. Coroutines and Flow: `fk-kotlin-coroutines-flows`; tests: `fk-kotlin-testing`.

## Null safety

- Non-nullable types by default; nullable only where absence is meaningful.
- `?.`, `?:`, `let` instead of `!!`; `!!` only with a comment proving non-null (or not at all).
- Treat Java platform types (`String!`) as nullable at the boundary and convert once.
- Chain safe calls (`user?.address?.city`) rather than nesting `let` blocks.

## Data and types

- `val` by default; `var` only for local mutation that reads better than a fold/copy. Prefer read-only collection types in APIs (`List`, `Map`) and build them with `buildList`/`map`/`filter`, unless the project's standards prefer otherwise for hot paths.
- `data class` for values; update with `copy()`; avoid `var` properties in data classes.
- `@JvmInline value class UserId(val value: String)` for ids and validated primitives (`init { require(...) }`).
- `sealed interface`/`sealed class` for closed hierarchies (results, UI states, API errors) with exhaustive `when` (no `else` branch, so new cases fail compilation).
- `enum class` for fixed sets without data; `data object` for singleton cases.

## Functions

- Expression bodies for single expressions; `when` as an expression.
- Named and default arguments instead of overload chains.
- Extension functions for domain helpers; keep them `private`/scoped when only one class needs them.
- Scope functions by intent: `let` (transform nullable), `apply` (configure and return object), `also` (side effect, return object), `run`/`with` (compute with receiver). Do not nest them.

## Errors

- Preconditions: `require` (arguments, `IllegalArgumentException`), `check` (state, `IllegalStateException`), `error("...")`.
- Expected failures: nullable return, `Result` (`runCatching { ... }.map { ... }.getOrElse { ... }`) or a sealed result type; exceptions for exceptional cases only.
- Never swallow `CancellationException` inside `runCatching`/`catch (e: Exception)` in coroutine code; rethrow it.

## Delegation and DSLs

- `by lazy` for expensive one-time init; `Delegates.observable` for change hooks; interface delegation (`class Logging(repo: Repo) : Repo by repo`) to decorate without inheritance.
- Type-safe builders with `@DslMarker` and lambdas with receiver for configuration DSLs; keep them small and documented.

## Collections and sequences

- Idiomatic operations: `filter`/`map`/`sortedBy`, `groupBy`, `associateBy`, `partition`, `minByOrNull`.
- `asSequence()` for long chains over large collections or infinite generators (`sequence { yield(...) }`); plain lists for small ones.

## Concurrency (summary)

Structured concurrency only: `coroutineScope { async {...}; async {...} }` for parallel work, `supervisorScope` when siblings may fail independently, no `GlobalScope`. Details in `fk-kotlin-coroutines-flows`.

## Build

- Gradle Kotlin DSL; versions in a version catalog (`libs.versions.toml`), `kotlin { jvmToolchain(N) }`.
- Static analysis: detekt (+ ktlint or the formatter the project uses) in CI; coverage via Kover if the project tracks it.

## Anti-patterns

| Bad | Good |
|---|---|
| `user!!.name` | `user?.name ?: default` or fail with `requireNotNull` and a message |
| mutable data classes | `val` + `copy()` |
| exceptions for expected absence | nullable return / `Result` |
| `GlobalScope.launch` | a lifecycle-bound scope |
| nested `let` chains | safe-call chain |
| catching `Exception` around suspend calls without rethrowing cancellation | catch specific exceptions, rethrow `CancellationException` |

## Review checklist

- [ ] No `!!` without justification; platform types handled
- [ ] Values immutable; sealed hierarchies with exhaustive `when`
- [ ] Value classes for ids and validated primitives
- [ ] Preconditions via `require`/`check`; expected failures not thrown
- [ ] Structured concurrency; cancellation respected
- [ ] detekt/ktlint clean

_Source: adapted from ECC `skills/kotlin-patterns` (MIT); see NOTICE.md._
