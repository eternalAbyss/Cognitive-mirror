# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`cognitive-mirror` CLI** — the project installs and runs from npm with no
  clone: `npx cognitive-mirror init && npx cognitive-mirror up`. Commands for
  `doctor`, `status`, `seed`, `reset`, `import`, and the stdio `mcp` server that
  Claude Desktop launches. Setup went from roughly a dozen manual steps to two.
- **OAuth 2.1 on the MCP server**, so claude.ai on web and mobile can reach the
  graph. S256 PKCE, dynamic client registration, a consent screen, single-use
  authorization codes, rotating refresh tokens, and hashed token storage.
  Enabled — and made mandatory — by setting `MCP_PUBLIC_URL`.
- **Cloudflare tunnel support** (`cognitive-mirror tunnel`) plus a Cloudflare
  Access policy guide and a credential-rotation runbook. This closes the last of
  the off-device work.
- Favicon, Apple touch icon, and Open Graph card.
- `SECURITY.md` with an honest trust model, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, and an MIT `LICENSE`.
- CI on Node 22 and 24, plus a release workflow that publishes with npm
  provenance. CI installs the built tarball outside the repo, because that is
  the only place packaging bugs show up.

  Provenance did not actually attach on 0.1.0: `pnpm publish` accepts
  `--provenance` and silently ignores it (pnpm#6607), so that release is
  unsigned and cannot be re-signed. The workflow now packs with pnpm — the only
  one of the two that resolves `workspace:*` — and publishes with npm, which is
  the only one that attaches the attestation. It authenticates with OIDC
  through npm trusted publishing rather than a token, and asserts the
  attestation exists on the registry afterwards instead of trusting the flag.
- Biome for linting and formatting; root vitest config with coverage.

### Changed

- **Cross-domain connections render in gold** (`#B07B16` light / `#D8A63E` dark)
  rather than purple, at a tube radius of `0.007`. Arcs are now theme-aware —
  `setTheme` previously left them alone, so one fixed gold washed out on the
  light theme.
- The MCP server runs on Express 5, which the MCP SDK's auth router expects.
- Untrusted artifact text is fenced in the enrichment prompt and the model is
  told to treat it as data.
- arXiv is fetched over https; its content is fed to the model and written to
  the graph, so cleartext was a real injection vector.

### Fixed

- **The visualiser bound `0.0.0.0`.** Every other service bound loopback, and
  this was the one that proxies unauthenticated node deletion, approval
  resolution, and billable research to anyone on the same network.
- **The budget breaker never tripped.** `MODEL_PRICES` was read from
  `process.env` but never declared in the config schema, so the price table was
  empty, every call cost $0, and `DAILY_BUDGET_USD` did nothing. Prices are now
  built in for the shipped models, and an unpriced model warns loudly.
- **Cypher injection** in the `updateNode` rollback path: patch keys were
  interpolated into a `REMOVE` clause unescaped. Keys are now constrained to
  plain identifiers at the schema, with a second check at the interpolation site.
- `updateNode` could overwrite `id`, `type`, `archived`, `createdAt`,
  `externalId`, and `summary_embedding` — breaking the id↔label invariant,
  resurrecting tombstones, or hijacking a dedup key.
- **The `/ingest` webhook failed open.** An unset `INGEST_TOKEN` meant "allow
  anything"; it now returns 401, with `ALLOW_ANONYMOUS_INGEST` as an explicit
  opt-out. Constant-time comparison, and the `?token=` query fallback is gone.
- Hitting the budget cap burned a retry, so five trips permanently failed a job
  that had never been processed. The worker now releases it instead.
- Job leases never expired, so a worker killed mid-job — which the shutdown
  script does every time — stranded that job in `leased` forever.
- The SSE proxy leaked a listener per page load against the MCP server's
  100-listener cap.
- `?limit=abc` reached Cypher as `LIMIT NaN` and returned a 500.
- A chunk overlap greater than or equal to the chunk size made the chunking loop
  step backwards and never terminate.
- Concurrent approval resolutions could both replay the same ops.
- The index-creation guard also swallowed "graph does not exist", hiding real
  failures until vector search silently returned nothing.

### Removed

- The author's absolute paths from the MCP docs, and `verify-stdio.ts`.
- `TODO.md` — its remaining items are done; its history lives here.
- The Claude Design brief and HTML prototype, which described an aesthetic the
  app deliberately moved away from.

## [0.1.0]

First working end-to-end version: the graph service with an op log and 24-hour
undo, the autonomous reasoning path (enrichment, daily brief, nightly
maintenance, live research), the interactive MCP path with 12 tools over stdio
and HTTP, ingestion from GitHub / Apple Shortcuts / YouTube / Kindle, and the
WebGL visualiser.
