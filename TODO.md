# TODO — Cognitive-mirror

What's left after Version 1. The core spine (graph-core, reasoning-daemon, ingestion, mcp-server),
the visualiser, and the ingestion sources (GitHub, notes/journal, YouTube, Kindle, daily world
brief) are all implemented.

## Off-device access (the remaining gap)

To use the second brain from claude.ai web/mobile or other devices, the MCP endpoint must be
reachable and authenticated. None of this is built yet — today it's localhost-only (Claude Desktop
over stdio works without any of it). See `apps/tunnel/README.md`.

- [ ] **Cloudflare tunnel** — wire up `cloudflared` from `apps/tunnel/config.template.yml`
      (currently only the template exists). Forwards `https://<host>` → `http://127.0.0.1:4003`.
- [ ] **OAuth on the MCP server** — so only your authenticated Claude account can invoke tools.
      The HTTP server (`apps/mcp-server`) is currently unauthenticated and must not be exposed via
      the tunnel until this lands.
- [ ] **IP allowlist** — restrict to Anthropic's published connector ranges via a Cloudflare
      Access policy, where feasible.
- [ ] **Credential rotation & access-log monitoring** for the tunnel.

## Recently completed (2026-06-23)

- **Cross-op atomicity** — `apps/graph-core/src/execute.ts` now applies each sub-op with a
  compensating inverse and rolls the whole batch back on any failure (FalkorDB can't wrap a
  multi-statement batch in one transaction, so this gives all-or-nothing semantics as observed by
  callers). Verified end-to-end against a live FalkorDB, including the tombstone/merge path. The
  one best-effort caveat: edges re-pointed onto a survivor during a merge are not un-pointed on
  rollback (same limitation as the 24h-window undo).
- **Budget persistence** — `apps/reasoning-daemon/src/budget.ts` now write-through persists spend to
  `BUDGET_STATE_PATH` (`.data/budget.json`), so the breaker survives restarts; also enforces the
  previously-unused monthly cap. Covered by `apps/reasoning-daemon/test/budget.test.ts`.
- **Full-text / keyword search** — the full-text index now backs a real `searchText` path
  (graph-core `/search/text`, graph-client `searchText`, and the `search_text` MCP tool), the
  lexical complement to semantic search.
