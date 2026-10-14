---
name: fk-redis-patterns
description: Use when adding Redis for caching, sessions, rate limiting, locks, pub/sub or streams, or reviewing key design, TTLs, eviction and connection settings.
---

# Redis patterns

Single commands are atomic; multi-step logic needs `MULTI/EXEC` pipelines or Lua scripts. Cache only after a measured need.

## Pick the structure

| Use | Structure | Key |
|---|---|---|
| Cached object | String (JSON) | `product:123` |
| Session | Hash | `session:<id>` |
| Counter / fixed-window limit | String + `INCR` | `ratelimit:user:123:<window>` |
| Leaderboard / sliding window | Sorted set | `scores:weekly` |
| Unique members | Set | `visitors:2026-01-01` |
| Approximate unique count | HyperLogLog | `hll:pageviews` |
| Durable queue / event log | Stream | `events:orders` |

## Keys and TTLs

- Naming `namespace:resource:id[:field]`; prefix per app when instances are shared.
- Every key gets a TTL (sessions ~24 h, API cache 5-15 min, rate windows = window, short tokens 5-10 min, reference data hours to days). Keys without TTL accumulate until memory runs out.
- Values under ~100 KB; store large blobs elsewhere and cache a reference.

## Caching

- **Cache-aside** (default): read -> miss -> load from DB -> `SET key value EX ttl`. Invalidate with `DEL` on every write path.
- **Write-through** when readers must see writes immediately: write DB, then set the cache.
- **Group invalidation**: track related keys in a tag set (`SADD tag:category:7 product:123` in the same pipeline) and delete the members when the group changes.
- **Stampede protection** on expensive misses: per-key lock (distributed lock below if multi-process) and re-check the cache after acquiring it, or early probabilistic refresh.
- Never cache user-specific data under a shared key.

## Rate limiting

- Fixed window: `INCR` + `EXPIRE` in one transaction pipeline; simple, allows bursts at window edges.
- Sliding window: Lua script over a sorted set (remove old scores, count, add unique member, set expiry) for accurate per-user limits.
- Use a shared Redis (not per-process memory) so limits hold across replicas.

## Distributed locks

- Acquire: `SET lock:<resource> <random-token> NX PX <ttl>`; TTL longer than the expected work.
- Release with a Lua compare-and-delete (only delete if the value equals your token), in a `finally` block.
- Locks on a single node are advisory; for correctness-critical work across nodes use a vetted Redlock library or a database constraint instead.

## Messaging

- Pub/Sub: fire-and-forget broadcast, no delivery guarantee or replay.
- Streams with consumer groups: at-least-once delivery, acknowledgements (`XACK`), replay, capped length (`MAXLEN`). Handlers must be idempotent.

## Connections and operations

- One pooled client per process with connect and command timeouts; size the pool to the workload.
- Use cluster or sentinel clients when the deployment uses them.
- Eviction: `allkeys-lru`/`allkeys-lfu` for pure caches; `noeviction` for instances holding queues or critical data. Keep caches and queues on separate instances or databases.
- Never `KEYS *` or `FLUSHALL` in production; use `SCAN` and scoped deletes.
- Require auth and TLS for any non-local instance; do not expose Redis to the internet.

## Review checklist

- [ ] Right structure per use; namespaced keys; TTL on every key
- [ ] Invalidation on every write path for cached entities
- [ ] Multi-step operations atomic (pipeline/Lua)
- [ ] Locks token-checked on release
- [ ] Streams (not Pub/Sub) where delivery matters
- [ ] Timeouts, pool size, eviction policy and auth configured

_Source: adapted from ECC `skills/redis-patterns` (MIT); see NOTICE.md._
