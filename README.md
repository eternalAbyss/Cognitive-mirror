# Cognitive-mirror

A local-first "second brain" PKM: it ingests your activity (GitHub commits, notes/journal via
Apple Shortcuts, YouTube videos, Kindle highlights, and a daily world brief), distils it into a
self-managing knowledge graph, and lets Claude reason over it two ways:

- **Interactive path** — a Claude client (Claude Desktop over stdio, or the HTTP MCP) talks to the
  **MCP server** (read + guided-write + live web-research tools).
- **Autonomous path** — a **reasoning daemon** calls the Anthropic API directly (enrichment, daily
  brief, nightly maintenance) and writes to the graph through the single-writer **Core Graph
  Service** (never through MCP).

A **visualiser** ("The Cognitive Mirror") renders the live graph and reasoning traces in the
browser. Knowledge data lives only on your machine.

> 📖 For the full deep reference — architecture, every tool and why, the API endpoints, the MCP
> functions, and the consolidation/merge/retrieval logic — see **[documentation.md](documentation.md)**.

## Status

**Implemented and working end-to-end:**
- **Core Graph Service** — single-writer FalkorDB owner; transactional batch writes are
  **all-or-nothing** (each sub-op carries a compensating inverse; a failed batch rolls back),
  with an op log + 24h undo window.
- **Autonomous path** — durable queue + worker, enrichment, daily world brief (ArXiv/RSS/
  GitHub-trending), nightly self-maintenance (merge / contradiction / cross-domain insight /
  archival), live web research, and a **budget breaker that persists across restarts** (daily +
  monthly caps).
- **Interactive path** — 12 MCP tools over HTTP + stdio, including **semantic and keyword search**,
  guided writes, web research, and cooperative conversation capture, plus a live event stream.
- **Ingestion** — GitHub poller + webhook for notes/journal (Apple Shortcuts), YouTube (MV3
  extension), and Kindle highlights.
- **Visualiser** — Next.js display layer, fully live-wired to the local services. Notes are
  **editable** (markdown, with live preview), **deletable** (soft-delete + undo), and every node
  type is browsable from the status bar.
- **Edited-note approval gate** — when the autonomous cleanup wants to merge or delete a note you
  hand-edited, it pauses and asks permission via a popup on the brief panel instead of acting.

**Remaining:** off-device access (Cloudflare tunnel + MCP OAuth) so claude.ai web/mobile can reach
the server — today it's localhost-only (Claude Desktop works without it). See [TODO.md](TODO.md).

## Stack (current / supported, June 2026)

| Concern | Choice | Notes |
|---|---|---|
| Graph + vectors | **FalkorDB** (Docker) | Replaces Kuzu (archived Oct 2025) **and** Qdrant; native Cypher + vector index |
| Embeddings | **Ollama** `nomic-embed-text` | 768-dim; config-driven model/dim |
| Search | FalkorDB **vector + full-text** indexes | semantic (`search_semantic`) and keyword (`search_text`) paths |
| Interactive reasoning | **MCP** `@modelcontextprotocol/sdk` v1 | Streamable HTTP (`:4003`) + stdio for Claude Desktop |
| Autonomous reasoning | **`@anthropic-ai/sdk`** | Haiku (enrich) / Sonnet (adjudicate) / Opus (insight) tiering |
| Live web research | Anthropic **web search** tool | `research_topic` writes web findings into the graph with citations |
| World brief sources | **ArXiv + RSS + GitHub-trending** | `rss-parser`; scored against your Concepts/Interests |
| Scheduling | **`node-cron`** | daily brief (07:00) + nightly maintenance (03:30) |
| Durable queue | **`node:sqlite`** (built-in) | Ingestion survives outages; no native build step |
| HTTP | **Hono** | graph-core internal API, ingestion webhook, daemon status/research |
| Visualiser | **Next.js 15 + React 19 + Three.js** | live-wired to the local services via same-origin API routes |
| Notifications | **ntfy** (optional) | budget-breaker / failed-job alerts |

## Layout

```
packages/shared        — schema, GraphOp types, config, logger, keychain, ntfy notify
packages/graph-client  — typed client to the Core Graph Service
packages/embeddings    — Ollama embed + chunking
packages/queue         — durable node:sqlite job queue (lease / complete / fail-with-backoff)

apps/graph-core        — ★ Core Graph Service: single writer, owns FalkorDB, op log + undo
apps/reasoning-daemon  — ★ autonomous path: worker, scheduler, enrichment, brief, maintenance, research, budget
apps/ingestion         — ★ durable queue + GitHub poller + webhook (notes/journal/YouTube/Kindle)
apps/mcp-server        — ★ interactive path: 12 MCP tools (HTTP + stdio) + live event stream
apps/visualiser        — ★ Next.js display layer, live-wired to the services (:4004)

apps/browser-extension/youtube — MV3 extension: capture the current YouTube video to ingestion
apps/tunnel            — Cloudflare tunnel config (Phase 0 stub — see TODO.md)
```
★ = implemented. Off-device public reachability (Cloudflare tunnel + MCP OAuth) is the main
remaining piece; see [TODO.md](TODO.md).

## Services & ports (all bind to 127.0.0.1)

| Service | Port |
|---|---|
| graph-core API | 4001 |
| ingestion webhook | 4002 |
| MCP server (HTTP) | 4003 |
| visualiser | 4004 |
| reasoning daemon status/research | 4005 |
| FalkorDB (+ Browser UI on 3001) | 6379 |
| Ollama | 11434 |

## Commands

> Prerequisites: **Docker** (for FalkorDB + Ollama), **Node ≥ 22**, and **pnpm 9**.

### First-time setup

```bash
cp .env.example .env     # fill ANTHROPIC_API_KEY and GITHUB_TOKEN (or store them in Keychain)
pnpm install
```

### Run the whole stack — one command

```bash
pnpm up        # starts FalkorDB + Ollama, pulls the embed model (first run), then
               # runs graph-core, ingestion, daemon, mcp-server AND the visualiser.
```

`pnpm up` runs in the foreground; the Cognitive Mirror UI is at **http://127.0.0.1:4004**.
Press **Ctrl-C** to stop the app services (the Docker data plane keeps running — use `pnpm down`
to stop that too). Script: [scripts/up.sh](scripts/up.sh).

### Stop everything

```bash
pnpm down      # stops the app services / visualiser (ports 4001-4005) AND the Docker
               # data plane (FalkorDB + Ollama). Data is preserved.
```

Use this from a second terminal, or any time the stack was detached or got stuck — it tears down
the whole supervisor tree, not just the foreground process. Script: [scripts/down.sh](scripts/down.sh).

### Reset (wipe local data)

```bash
pnpm reset     # clears the FalkorDB graph + the durable queue + the budget state.
               # Stop the stack first (pnpm down). Docker volumes are kept; data is gone.
```

### Infrastructure-only / granular commands

```bash
pnpm db:up            # start just FalkorDB + Ollama (Docker)
pnpm db:down          # stop just the Docker data plane
pnpm setup:ollama     # pull the embedding model into the Ollama container
pnpm dev              # backend services only (graph-core, ingestion, daemon, mcp) — no visualiser
pnpm dev:all          # all backend services + the visualiser (what `pnpm up` runs after infra)
pnpm seed             # inject a sample ingestion job end-to-end
pnpm build | pnpm typecheck | pnpm test    # workspace-wide
```

### Ingest sources

- **GitHub repositories** — one-shot import of every repo you own (README + description + language
  + topics → Concepts): `pnpm --filter @cm/ingestion repos` (needs `GITHUB_TOKEN`; add
  `--no-archived` to skip archived repos). Re-runnable and idempotent: each repo upserts a single
  Source node keyed by its `github:owner/repo` identity, so re-pulling updates that node in place
  (even when the README changed) instead of creating duplicates.
- **GitHub commits** — polled automatically for the repos listed in `GITHUB_REPOS` (`.env`).
- **Notes / journal** (Apple Shortcuts) — see [apps/ingestion/SHORTCUTS.md](apps/ingestion/SHORTCUTS.md).
- **YouTube** — load the MV3 extension, see [apps/browser-extension/youtube/README.md](apps/browser-extension/youtube/README.md).
- **Kindle highlights** — `pnpm --filter @cm/ingestion kindle <path to My Clippings.txt>`.

### Reasoning daemon, on demand

```bash
pnpm --filter @cm/reasoning-daemon brief      # run the daily world brief once, now
pnpm --filter @cm/reasoning-daemon maintain   # run nightly maintenance once, now
```

### Connect a Claude client

- **Claude Desktop** (local, no tunnel/OAuth needed) — see [apps/mcp-server/CLAUDE_DESKTOP.md](apps/mcp-server/CLAUDE_DESKTOP.md).
- **claude.ai web / mobile** — needs the Cloudflare tunnel + MCP OAuth (not yet built; see
  [TODO.md](TODO.md) and [apps/tunnel/README.md](apps/tunnel/README.md)).
