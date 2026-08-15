# @cm/queue

A durable, SQLite-backed job queue. Ingestion enqueues; the reasoning daemon
leases, completes, or fails with backoff.

Built on **`node:sqlite`** rather than `better-sqlite3` — no native build step,
which is what lets the CLI install from npm on any platform without a compiler.

## Behaviour worth knowing

**Idempotent.** `content_hash` is unique, so re-seeing an unchanged artifact is a
no-op rather than a duplicate. This is what makes 5-minute GitHub polling safe.

**Backoff, then failure.** `fail()` increments the attempt count and schedules a
retry with exponential backoff, marking the job `failed` at `maxAttempts`.

**`release()` doesn't count as an attempt.** For conditions that say nothing
about the job — the budget breaker being open is the motivating case. Using
`fail()` there would discard perfectly good captured content after five trips
that never processed it.

**Leases expire.** A worker killed mid-job used to strand that job in `leased`
forever: never retried, never surfaced in `failed`, invisible in `stats`. Stale
leases are reclaimed on construction, so a daemon restart recovers them.
