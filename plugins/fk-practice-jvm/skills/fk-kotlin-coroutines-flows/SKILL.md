---
name: fk-kotlin-coroutines-flows
description: Use when writing or debugging Kotlin coroutines or Flow (Android, KMP, server) - scopes, structured concurrency, dispatchers, cancellation, StateFlow/SharedFlow, operators and coroutine tests.
---

# Kotlin coroutines and Flow

## Structured concurrency

- Launch only in lifecycle-bound scopes: `viewModelScope`, `lifecycleScope`, `LaunchedEffect`, a server request scope, or an injected application `CoroutineScope` with a `SupervisorJob`. Never `GlobalScope`.
- Parallel decomposition: `coroutineScope { val a = async { ... }; val b = async { ... }; Result(a.await(), b.await()) }`; one failure cancels the siblings.
- Independent children: `supervisorScope { launch {...}; launch {...} }`; handle each child's failure inside it.
- Suspend functions are main-safe: they switch to the right dispatcher internally (`withContext`), callers do not.

## Dispatchers

- `Dispatchers.Default` for CPU work, `Dispatchers.IO` for blocking I/O (JVM/Android only; on other KMP targets use `Default` or an injected dispatcher), `Dispatchers.Main` for UI.
- Inject dispatchers (constructor parameter) so tests can substitute a `TestDispatcher`.

## Cancellation

- Cooperative: call `ensureActive()`/`yield()` in long loops; use cancellable APIs.
- Never swallow `CancellationException` (catch specific exceptions, or rethrow it); `runCatching` around suspend calls needs the same care.
- Cleanup in `finally`; suspend cleanup inside `withContext(NonCancellable) { ... }`.
- Timeouts with `withTimeout`/`withTimeoutOrNull`.

## Flow

- Cold `flow { }` for streams produced on demand; repositories expose `Flow<T>` mapped to domain types.
- UI state: `StateFlow` built with `stateIn(scope, SharingStarted.WhileSubscribed(5_000), initial)`; combine sources with `combine(a, b, c) { ... }`.
- Private `MutableStateFlow`, public read-only `StateFlow`; update with `_state.update { it.copy(...) }` using immutable values.
- One-off events (navigation, snackbars): a `Channel(BUFFERED)` exposed with `receiveAsFlow()`, or `SharedFlow` when every collector must see them; decide whether events may be dropped when no collector is active.
- Operators: `debounce` + `distinctUntilChanged` + `flatMapLatest`/`mapLatest` for search; `catch` for upstream errors (emit a fallback), `retryWhen` with backoff for transient I/O; `flowOn` changes the upstream dispatcher only.
- Collect UI flows lifecycle-aware (`collectAsStateWithLifecycle`, `repeatOnLifecycle`); in Compose create flows inside `remember` or in the ViewModel, not per recomposition.

## Testing

- `runTest { }` with virtual time; `advanceUntilIdle()`, `advanceTimeBy(ms)`; inject `StandardTestDispatcher(testScheduler)` (or `UnconfinedTestDispatcher` for eager collection).
- Replace `Dispatchers.Main` with `Dispatchers.setMain(testDispatcher)` in Android tests and reset after.
- Turbine for flows: `flow.test { assertEquals(initial, awaitItem()); ...; cancelAndIgnoreRemainingEvents() }`.
- Fakes backed by `MutableStateFlow` instead of mocking flows.
- No `Thread.sleep` or real delays.

## Anti-patterns

- `GlobalScope`, unscoped `CoroutineScope()` without cancellation.
- Collecting in `init {}` without a scope; launching from constructors in libraries.
- Mutable collections inside `StateFlow`.
- Catching `CancellationException` or using `catch (e: Throwable)` without rethrowing it.
- Blocking calls on `Default`/`Main`.

_Source: adapted from ECC `skills/kotlin-coroutines-flows` (MIT); see NOTICE.md._
