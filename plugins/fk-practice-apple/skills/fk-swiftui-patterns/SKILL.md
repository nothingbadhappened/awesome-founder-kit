---
name: fk-swiftui-patterns
description: Use when building or reviewing SwiftUI views - state wrappers and @Observable models, environment injection, view composition, NavigationStack routing, list performance, previews.
---

# SwiftUI patterns

Project ADRs win (minimum OS version, architecture style). Older deployment targets without the Observation framework keep `ObservableObject`.

## State: pick the simplest wrapper

| Need | Use |
|---|---|
| View-local value (toggle, field, sheet flag) | `@State private var` |
| Two-way access to a parent's value | `@Binding` |
| Model the view owns | `@Observable` class held in `@State` |
| Model passed in, read-only | plain `let`/`var` property of the `@Observable` type |
| Bindings into a passed-in model | `@Bindable` |
| App-wide dependency | `@Environment(Type.self)` injected with `.environment(obj)` |

- New code on supported OS versions: `@Observable` (property-level invalidation) instead of `ObservableObject`/`@Published`/`@StateObject`/`@EnvironmentObject`.
- Models: `@Observable final class`, `private(set)` for state the view only reads, dependencies injected through `init` with protocol types (`any ItemRepository`) and production defaults.
- Only the owner creates a model in `@State`; children receive it.

## Async work

- Start loading in `.task { await model.load() }` (cancelled automatically when the view disappears); `.task(id:)` to restart on input change.
- Never do I/O, networking or heavy computation in `body` or `init`.
- Models touched by the UI run on the main actor (default isolation in Swift 6.2 app targets, see `fk-swift-concurrency`); offload heavy work explicitly.
- Represent loading/empty/error states explicitly and show them.

## Composition

- Small subviews that take only the data they read, so changes invalidate only those subviews.
- `ViewModifier` + a `View` extension (`.cardStyle()`) for reusable styling.
- `@ViewBuilder` or `Group` for conditional content; avoid `AnyView`.

## Navigation

- `NavigationStack(path:)` with a `NavigationPath` (or typed array) owned by an `@Observable` router; destinations as a `Hashable` enum handled in one `.navigationDestination(for:)`.
- Deep links map URLs to the same destination enum.

## Performance

- `LazyVStack`/`LazyHStack`/`List` for long collections; stable ids in `ForEach` (`Identifiable` or a stable key path, never indices for mutable data).
- Limit `.shadow`, `.blur`, `.mask` and heavy effects inside scrolling lists (offscreen rendering).
- For expensive bodies with value inputs, conform to `Equatable` so SwiftUI can skip re-renders.
- Profile with Instruments (SwiftUI and Time Profiler templates) before optimizing.

## Accessibility and platform

- Dynamic Type friendly layouts, `accessibilityLabel` for icon-only controls, sufficient contrast, VoiceOver order checked.
- Follow the platform's Human Interface Guidelines and the project's design system.

## Previews

`#Preview("Empty") { ItemListView(model: .init(repository: EmptyRepository())) }`, one preview per meaningful state (empty, loaded, error, large text), using in-memory fakes.

## Anti-patterns

- `ObservableObject` stack in new code where `@Observable` is available.
- Async work in `body`/`init`; models created in `@State` by views that do not own them.
- `AnyView` type erasure; index-based identity.
- Ignoring `Sendable` when moving data to and from actors.

_Source: adapted from ECC `skills/swiftui-patterns` (MIT); see NOTICE.md._
