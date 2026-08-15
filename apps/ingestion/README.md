# ingestion — capture

Gets things into the queue. Does no reasoning: it authenticates, hashes, and
enqueues, and the [reasoning daemon](../reasoning-daemon) does the rest.

Runs on `127.0.0.1:4002`.

## Sources

| Source | Mechanism |
|---|---|
| GitHub commits | Polls `GITHUB_REPOS` every `GITHUB_POLL_INTERVAL_MS` |
| Notes & journal | `POST /ingest` — Apple Shortcuts ([SHORTCUTS.md](SHORTCUTS.md)) |
| YouTube | `POST /ingest` from the [browser extension](../browser-extension) |
| Kindle highlights | `cognitive-mirror import kindle "…/My Clippings.txt"` |
| GitHub repos | `cognitive-mirror import repos` |

## Authentication

`/ingest` **fails closed**: with no `INGEST_TOKEN` set it returns 401. Set
`ALLOW_ANONYMOUS_INGEST=true` to opt out for local experimentation.

The token must arrive as `Authorization: Bearer <token>` and is compared in
constant time. There is deliberately no `?token=` query fallback — query strings
end up in access logs, browser history, and `Referer` headers.

## Durability

The queue is `node:sqlite` (`packages/queue`), which is why capture survives an
internet or API outage: the artifact is stored the moment it arrives and enriched
whenever the daemon can.

Two properties worth knowing:

- **Idempotent.** `content_hash` is unique, so re-seeing an unchanged artifact —
  which the 5-minute GitHub poll does constantly — is a no-op rather than a
  duplicate.
- **Leases expire.** A worker killed mid-job used to strand that job in `leased`
  forever; stale leases are now reclaimed on boot.
