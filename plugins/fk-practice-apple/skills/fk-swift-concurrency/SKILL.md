---
name: fk-swift-concurrency
description: Use when adopting Swift 6.2 approachable concurrency or fixing Swift data-race errors - main-actor default isolation, async on the caller's actor, @concurrent offloading, isolated conformances.
---

# Swift concurrency (Swift 6.2 approachable concurrency)

Swift 6.2 makes code single-threaded by default and concurrency explicit. Check the project's Swift version and build settings first; the patterns below assume the 6.2 features are enabled.

## What changed

- **Async stays on the caller's actor** (SE-0461, `NonisolatedNonsendingByDefault`): a nonisolated async function called from the main actor runs on the main actor, removing many "sending ... risks causing data races" errors from Swift 6.0/6.1.
- **Main-actor default isolation** (SE-0466): opt-in mode where unannotated declarations in a module are `@MainActor`. Recommended for app and executable targets; libraries usually stay nonisolated.
- **Isolated conformances**: a main-actor type can conform to a nonisolated protocol with `extension Model: @MainActor Exportable { ... }`; the compiler only allows using that conformance on the main actor.
- **`@concurrent`**: explicit opt-in to run an async function on the concurrent thread pool.

## Steps to adopt

1. Enable the settings incrementally: Xcode build settings (Swift Compiler > Concurrency: approachable concurrency, default actor isolation = MainActor for app targets) or `swiftSettings` in `Package.swift` (`.defaultIsolation(MainActor.self)`, upcoming features).
2. Run the migration tooling / fix-its; rebuild and treat every reported race as real.
3. Protect global and static mutable state with `@MainActor` (or make it immutable and `Sendable`); singletons like `static let shared` need isolation.
4. Replace `nonisolated` workarounds and `@Sendable` wrappers on main-actor types with isolated conformances.
5. Profile (Instruments) and offload only measured hot paths with `@concurrent`.

## Offloading heavy work

```swift
nonisolated final class PhotoProcessor {
    func extractSticker(data: Data, id: String) async -> Sticker {
        await Self.extractSubject(from: data)      // caller's actor until here
    }
    @concurrent
    static func extractSubject(from data: Data) async -> Sticker { /* CPU-heavy */ }
}
```

To use `@concurrent`: make the containing type (or function) `nonisolated`, mark the function `@concurrent` and `async`, `await` it at call sites, and pass only `Sendable` values across.

## Shared mutable state

- UI-facing state: `@MainActor` (default in app targets).
- Shared non-UI state: an `actor` (see `fk-swift-actor-persistence`); expose domain operations, not internal storage.
- Values crossing isolation boundaries are `Sendable` (structs/enums of `Sendable` members, final classes with immutable state, or actors).
- Avoid `@unchecked Sendable` except for audited types with internal locking.

## Anti-patterns

- `@concurrent` on every async function (most need no background execution).
- `nonisolated` or `@preconcurrency` sprinkled to silence errors without understanding the isolation.
- New `DispatchQueue`/lock-based synchronization where actors fit.
- Assuming `async` means "runs in the background".
- Unstructured `Task { }` without handling cancellation; prefer `.task` in SwiftUI and structured `async let` / task groups.

## Review checklist

- [ ] Build settings declare the intended isolation per target
- [ ] Globals/singletons isolated or immutable `Sendable`
- [ ] Heavy work offloaded only where profiled, via `@concurrent`
- [ ] Isolated conformances instead of `nonisolated` hacks
- [ ] No compiler concurrency warnings suppressed without a written reason

_Source: adapted from ECC `skills/swift-concurrency-6-2` (MIT); see NOTICE.md._
