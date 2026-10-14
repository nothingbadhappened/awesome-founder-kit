---
name: fk-swift-protocol-di-testing
description: Use when Swift code touching the file system, network, iCloud or other external APIs needs tests - small Sendable protocols, default production implementations, configurable fakes, Swift Testing.
---

# Protocol-based dependency injection for Swift tests

Mock boundaries you do not own (file system, network, iCloud, clocks, system services), not your own internal types.

## Steps

1. **One small protocol per external concern**, `Sendable` when used across actors:
   ```swift
   public protocol FileAccessorProviding: Sendable {
       func read(from url: URL) throws -> Data
       func write(_ data: Data, to url: URL) throws
       func fileExists(at url: URL) -> Bool
   }
   ```
   Separate protocols for container lookup, bookmarks, HTTP, time; no "god protocol".
2. **Default production implementation** as a struct wrapping the real API (`FileManager`, `URLSession`, `Data.write(options: .atomic)`).
3. **Inject with defaults**: `init(fileAccessor: any FileAccessorProviding = DefaultFileAccessor())`. Production call sites stay unchanged; tests and previews pass fakes.
4. **Fakes with configurable failures**: in-memory storage plus optional `readError`/`writeError` properties; mark `@unchecked Sendable` only for test-only fakes whose mutation is confined to the test, or make them actors.
5. **Tests with Swift Testing** (`import Testing`):
   ```swift
   @Test("sync fails when the container is unavailable")
   func missingContainer() async {
       let manager = SyncManager(fileSystem: FakeFileSystem(containerURL: nil))
       await #expect(throws: SyncError.containerNotAvailable) { try await manager.sync() }
   }
   ```
   Use `#expect`/`#require`, parameterized `@Test(arguments:)` for input tables, and suites (`@Suite`) to group related tests. XCTest remains fine where the project uses it.

## What to cover

- Happy path with fake data.
- Each failure mode the fake can simulate (missing file, corrupt data, write failure, offline network, timeout) and the resulting error or user-visible state.
- Behaviour across actor boundaries (await, cancellation).

## Networking

- Prefer a protocol over your API client (`func send<T: Decodable>(_ request: Request) async throws -> T`) and fake it in unit tests.
- For client-level tests, a custom `URLProtocol` subclass registered on a `URLSessionConfiguration` returns canned responses without real network calls.

## Anti-patterns

- `#if DEBUG` branches instead of injection.
- Protocols for types without external dependencies (over-engineering).
- Mocking internal types; asserting call order where outcomes suffice.
- Forgetting `Sendable` on protocols used by actors.

_Source: adapted from ECC `skills/swift-protocol-di-testing` (MIT); see NOTICE.md._
