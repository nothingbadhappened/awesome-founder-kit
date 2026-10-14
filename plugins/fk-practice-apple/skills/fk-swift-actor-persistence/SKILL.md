---
name: fk-swift-actor-persistence
description: Use when building local persistence or shared mutable state in Swift and data races must be designed out - actor-based repository with in-memory cache and atomic file writes.
---

# Actor-based persistence in Swift

For small to medium local data (settings, cached content, offline-first records). For relational queries, large datasets or sync, use SwiftData/Core Data/SQLite per the project's ADR; the actor-isolation principles still apply.

## Pattern

1. Declare an `actor` repository generic over `Codable & Identifiable & Sendable` models, holding a private `[ID: Model]` cache and a file URL.
2. Load synchronously in `init` from the file (decode errors -> start empty, and log them; do not silently discard real corruption in production).
3. Expose a minimal domain API: `save(_:)`, `delete(_:)`, `find(by:)`, `loadAll()`. Never expose the cache dictionary.
4. On every write, update the cache, encode, and write with `data.write(to: url, options: .atomic)` so a crash cannot leave a half-written file.
5. Callers `await` every call; view models (`@Observable`, main actor) reload state from the actor after writes.

```swift
public actor LocalRepository<T: Codable & Identifiable & Sendable> where T.ID == String {
    private var cache: [String: T]
    private let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
        self.cache = Self.load(from: fileURL)
    }
    public func save(_ item: T) throws { cache[item.id] = item; try persist() }
    public func delete(_ id: String) throws { cache[id] = nil; try persist() }
    public func find(by id: String) -> T? { cache[id] }
    public func loadAll() -> [T] { Array(cache.values) }

    private func persist() throws {
        try JSONEncoder().encode(Array(cache.values)).write(to: fileURL, options: .atomic)
    }
    private static func load(from url: URL) -> [String: T] {
        guard let data = try? Data(contentsOf: url),
              let items = try? JSONDecoder().decode([T].self, from: data) else { return [:] }
        return Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
    }
}
```

## Design rules

- Actor instead of class + lock or `DispatchQueue`: the compiler enforces serialized access.
- Everything crossing the actor boundary is `Sendable`.
- File location chosen by the app (Application Support for app data, Caches for re-creatable data), validated, and excluded from backups when appropriate; protect sensitive data with Data Protection classes or the Keychain (never store secrets in plain files).
- Writing the whole file on every change is fine for small datasets; batch or move to a database when writes or size grow.
- Keep the file format versioned so models can evolve (migration on load).

## Testing

- Inject the file URL (a temp directory per test) or a file-access protocol (`fk-swift-protocol-di-testing`) to test read/write errors.
- Test: save then find; delete; reload from disk in a new instance; corrupted file handling; concurrent saves from multiple tasks keep all items.

## Anti-patterns

- Exposing internal storage or making the actor's API mirror the file format.
- `nonisolated` members that touch mutable state.
- Non-atomic writes; unvalidated, caller-supplied paths.
- Forgetting that callers are async (blocking the main actor while waiting).

_Source: adapted from ECC `skills/swift-actor-persistence` (MIT); see NOTICE.md._
