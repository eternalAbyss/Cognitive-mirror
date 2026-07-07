# Cognitive-mirror — Full Documentation

A local-first **"second brain"** — a personal knowledge management system that ingests your
activity, distils it into a self-managing knowledge graph, and lets Claude reason over it. All
knowledge data lives on your machine.

This document is the single deep reference. For the quick command list see the
[README](README.md); for what's left to build see [TODO.md](TODO.md).

---

## Table of contents

1. [What the application does](#1-what-the-application-does)
2. [The knowledge graph (data model)](#2-the-knowledge-graph-data-model)
3. [Architecture: the two reasoning paths](#3-architecture-the-two-reasoning-paths)
4. [Technology stack — and why each tool](#4-technology-stack--and-why-each-tool)
5. [Repository structure](#5-repository-structure)
6. [Local setup — step by step](#6-local-setup--step-by-step)
7. [Scripts explained](#7-scripts-explained)
8. [Configuration (environment variables)](#8-configuration-environment-variables)
9. [Features in depth](#9-features-in-depth)
10. [API endpoints](#10-api-endpoints)
11. [MCP functions (tools)](#11-mcp-functions-tools)
12. [Core logic: consolidation, merges, retrieval](#12-core-logic-consolidation-merges-retrieval)

---

## 1. What the application does

Cognitive-mirror continuously **captures** what you read, write, and build; **enriches** it into a
graph of concepts and sources; **self-maintains** that graph (merging duplicates, flagging
contradictions, surfacing cross-domain insights, archiving stale material); and **exposes** the
result to Claude two ways — interactively (you ask; Claude searches the graph) and autonomously
(a background daemon reasons over the graph on a schedule and on every new ingestion).

Concretely, the system:

- **Ingests** from many sources into one durable queue:
  - GitHub commits (polled), notes & journal entries (Apple Shortcuts → webhook), YouTube videos
    (browser extension), Kindle highlights (CLI import), and a daily "world brief" pulled from
    ArXiv / RSS / GitHub-trending.
- **Enriches** each captured artifact with Claude into a `Source` node plus extracted `Concept`
  nodes, typed edges, and embeddings — all written atomically through a single writer.
- **Retrieves** knowledge three ways: **semantic** (vector) search, **keyword** (full-text)
  search, and **content-chunk** retrieval for grounding answers, plus graph **traversal**.
- **Self-maintains** the graph nightly (and after ingestion): a two-stage merge/contradiction
  gate, contradiction **synthesis**, cross-domain **insight** detection, and time-decay
  **archival** — every destructive operation logged with a 24-hour undo window.
- **Researches** topics on the live web on demand (Anthropic web search) and writes the findings
  back into the graph with citations.
- **Resurfaces** open conversation loops at the start of a new session.
- **Visualises** everything in real time — a 3D knowledge sphere with live reasoning traces.

---

## 2. The knowledge graph (data model)

Everything is one graph in FalkorDB. Every knowledge node carries the generic `:Node` label plus a
specific type label (e.g. `:Node:Concept`), so a **single vector index** over
`Node.summary_embedding` covers semantic search across all types. Defined in
[packages/shared/src/schema.ts](packages/shared/src/schema.ts).

### Node types

| Type | Meaning | Created by |
|---|---|---|
| `Concept` | A durable, reusable idea | Enrichment, MCP `create_concept` |
| `Source` | A captured artifact (commit, note, video, paper…) | Enrichment |
| `Conversation` | A captured chat session (cooperative capture) | MCP `checkpoint_conversation` |
| `Interest` | A bootstrapped domain to score world-signal against | MCP `create_interest` |
| `WorldEvent` | A synthesised observation from the daily brief | Daily brief |
| `Synthesis` | A reconciliation of two contradicting concepts | Maintenance (contradiction) |
| `Insight` | A non-obvious cross-domain parallel | Maintenance (cross-domain) |
| `Tombstone` | A node that was merged into a survivor (kept for undo) | Maintenance (merge) |

A `ContentChunk` (label `:Chunk`) is **not** a knowledge node — it is an embedding artifact for
retrieval, linked to its `Source` by a `HAS_CHUNK` edge and handled separately.

### Edge types

| Edge | Meaning |
|---|---|
| `RELATES_TO` | Two ideas are genuinely connected |
| `CONTRADICTS` | Two ideas assert opposing claims |
| `DERIVED_FROM` | A `Synthesis`/`Insight` was derived from its parents |
| `MENTIONS` | A `Source` mentions a `Concept` |
| `MERGED_INTO` | A `Tombstone` points to the survivor it merged into |
| `HAS_CHUNK` | A `Source` owns a content chunk (not a knowledge edge) |

### Key node properties

`id` (uuid), `type`, `title`, `summary`, `content`, `domain`, `confidence` (0–1), `asOf`,
`archived`, `createdAt`, `updatedAt`, `metadata` (JSON-stringified at the storage layer),
`summary_embedding` (vecf32), plus retrieval-recency fields `touchCount` / `lastReadAt` and merge
controls `prevType` / `mergeCooldownUntil`.

---

## 3. Architecture: the two reasoning paths

```
                              ┌──────────────────────────────────────────┐
   Ingestion sources          │            Core Graph Service            │
   (GitHub, notes, YT,        │              (graph-core)                │
    Kindle, brief)            │   single writer · owns FalkorDB ·        │
        │                     │   op log + 24h undo · vector/full-text   │
        ▼                     │   indexes · HTTP API :4001               │
  ┌─────────────┐  enqueue    └──────────────▲───────────────▲───────────┘
  │  ingestion  │──────┐                     │ writes        │ reads
  │   :4002     │      │             (execute, single path)  │
  └─────────────┘      ▼                      │               │
                 ┌──────────────┐  lease   ┌──┴────────────┐  │
                 │ durable queue│◀─────────│ reasoning     │  │
                 │ node:sqlite  │          │ daemon :4005  │  │   AUTONOMOUS PATH
                 └──────────────┘          │ worker +      │  │   (Anthropic API directly)
                                           │ scheduler     │  │
                                           └───────────────┘  │
                                                              │
                 ┌───────────────┐  reads/guided writes       │
   Claude  ◀────▶│  mcp-server   │────────────────────────────┘   INTERACTIVE PATH
   client        │  :4003 (+stdio)│  emits live events ──────┐     (MCP tools)
                 └───────────────┘                          ▼
                                                   ┌──────────────────┐
                                                   │   visualiser     │
                                                   │   :4004 (Next.js)│  live graph + traces
                                                   └──────────────────┘
```

- **Interactive path** — a Claude client (Claude Desktop over stdio, or HTTP) calls **MCP tools**
  on `mcp-server`. Reads emit live events; writes go through the same transactional primitive the
  daemon uses.
- **Autonomous path** — the **reasoning daemon** calls the Anthropic API directly (enrichment,
  brief, maintenance, research) and writes to the graph **through graph-core, never through MCP**.

The crucial invariant: **graph-core is the single writer.** Both paths funnel every mutation
through `executeOps`, so there is one op log entry per batch and no write races.

---

## 4. Technology stack — and why each tool

| Concern | Choice | Why this one |
|---|---|---|
| **Graph + vectors** | **FalkorDB** (Docker) | One store for both the graph **and** the vector index (native Cypher + `vecf32` cosine index). Replaces the original Kuzu + Qdrant pair — Kuzu was archived (Oct 2025) and a second vector DB added moving parts. One DB = one transaction boundary, one backup, one writer. **Persisted via AOF** to a named volume at `/var/lib/falkordb/data` (FalkorDB's real data dir — not `/data`), so the graph survives `pnpm down`/`up`. |
| **Embeddings** | **Ollama** running `nomic-embed-text` | Local, free, private — embeddings never leave the machine. 768-dim, model/dim are config-driven so you can swap models. |
| **Interactive reasoning** | **MCP** (`@modelcontextprotocol/sdk` v1) | The standard protocol Claude clients speak. Streamable HTTP for the network case; **stdio** for Claude Desktop (zero network, maximum privacy). |
| **Autonomous reasoning** | **`@anthropic-ai/sdk`** | Direct API access for background jobs that must run without a human in the loop, with **model tiering** (Haiku → Sonnet → Opus) to match cost to task. |
| **Live web research** | Anthropic **web search** server tool | Grounded, cited research that flows back into the graph through the same enrichment pipeline. |
| **World-brief sources** | **ArXiv + RSS + GitHub-trending** (`rss-parser`) | Cheap, public, no-auth feeds of fresh signal to score against your interests. |
| **Scheduling** | **`node-cron`** | In-process cron for the daily brief (07:00) and nightly maintenance (03:30) — no external scheduler to deploy. |
| **Durable queue** | **`node:sqlite`** (Node built-in) | Persisting jobs is what makes ingestion survive outages. The built-in driver needs **no native build step** — important on bleeding-edge Node where `better-sqlite3` has no prebuilt binary. |
| **HTTP framework** | **Hono** | Tiny, fast, typed — used for graph-core's internal API, the ingestion webhook, and the daemon's status/research endpoints. |
| **MCP HTTP server** | **Express** | The MCP SDK's Streamable-HTTP transport plugs straight into Express. |
| **Visualiser** | **Next.js 15 + React 19 + Three.js** | Server API routes proxy the localhost-only services (browser stays same-origin); Three.js renders the WebGL knowledge sphere. |
| **Notifications** | **ntfy** (optional) | Push alerts when the budget breaker trips or a job exhausts retries. |
| **Validation** | **Zod** | One schema source for config, ops, ingest payloads, and API bodies. |
| **Secrets** | macOS **Keychain** (fallback) | Keeps the Anthropic key / GitHub token out of plaintext env files on the deployment box. |
| **Logging** | **pino** | Structured JSON logs; on the MCP **stdio** server all logs go to stderr so the protocol stream stays clean. |
| **Monorepo** | **pnpm workspaces + tsup + tsx + vitest** | Shared packages without publishing; `tsx` for dev/watch, `tsup` for builds, `vitest` for tests. |

---

## 5. Repository structure

```
Cognitive-mirror/
├─ packages/                         # shared libraries (workspace, not published)
│  ├─ shared/                        # the contract layer used by everything
│  │  └─ src/
│  │     ├─ schema.ts                # node/edge types, GraphNode shape
│  │     ├─ ops.ts                   # GraphOp union + ExecuteRequest/Result (the write API)
│  │     ├─ ingest.ts                # EnrichPayload schema + job-type constants
│  │     ├─ config.ts                # zod-validated env config (+ Keychain, repo-root anchoring)
│  │     ├─ keychain.ts              # macOS Keychain secret lookup
│  │     ├─ logger.ts                # pino logger (stderr-safe)
│  │     └─ notify.ts                # ntfy push notifications
│  ├─ graph-client/                  # typed HTTP client to graph-core (the sole write path)
│  ├─ embeddings/                    # Ollama embed() + chunkText() + ensureEmbedModel()
│  └─ queue/                         # durable node:sqlite job queue
│
├─ apps/
│  ├─ graph-core/                    # ★ Core Graph Service — single writer, owns FalkorDB
│  │  └─ src/
│  │     ├─ index.ts                 # boots: ensure indexes, serve Hono API on :4001
│  │     ├─ falkor.ts                # sole FalkorDB connection + query() + vecLiteral()
│  │     ├─ indexes.ts               # idempotent index bootstrap (range/vector/full-text)
│  │     ├─ api.ts                   # the HTTP API (reads, /execute, maintenance, undo)
│  │     ├─ execute.ts               # executeOps — atomic batch writes with rollback
│  │     ├─ oplog.ts                 # op-log append + recent + undo (24h window)
│  │     ├─ repo.ts                  # read queries (getNode, search*, traverse)
│  │     ├─ maintenance.ts           # read-side support for the maintenance engine
│  │     └─ reset.ts                 # wipe the graph
│  │
│  ├─ reasoning-daemon/              # ★ autonomous path — Anthropic API, never via MCP
│  │  └─ src/
│  │     ├─ index.ts                 # boots worker + scheduler + health + status
│  │     ├─ worker.ts                # lease→run→complete/fail-with-backoff loop
│  │     ├─ scheduler.ts             # node-cron: daily brief + nightly maintenance
│  │     ├─ enrich.ts                # artifact → Source + Concepts + edges + embeddings
│  │     ├─ anthropic.ts             # all Claude calls (tiered) + JSON parsing
│  │     ├─ embeddings.ts            # re-exports the embeddings package
│  │     ├─ brief.ts                 # daily world brief
│  │     ├─ maintenance/index.ts     # the maintenance engine (merge/contradiction/insight/prune)
│  │     ├─ research.ts              # live web research → graph
│  │     ├─ budget.ts                # persistent budget breaker (daily + monthly)
│  │     ├─ sources/                 # arxiv.ts, rss.ts, github-trending.ts (brief inputs)
│  │     ├─ status-server.ts         # :4005 — /status, /research, /health
│  │     ├─ health.ts                # periodic self health probe
│  │     ├─ brief-run.ts             # run the brief once (CLI)
│  │     └─ maintain-run.ts          # run maintenance once (CLI)
│  │
│  ├─ ingestion/                     # ★ durable capture surface
│  │  └─ src/
│  │     ├─ index.ts                 # boots the webhook + GitHub poller on :4002
│  │     ├─ server.ts                # Hono webhook: POST /ingest (auth, hash, enqueue)
│  │     ├─ github-poller.ts         # poll commits → enqueue enrich jobs
│  │     ├─ hash.ts                  # content hashing for idempotency
│  │     ├─ kindle-parse.ts          # parse "My Clippings.txt"
│  │     ├─ import-kindle.ts         # CLI: import Kindle highlights
│  │     └─ seed.ts                  # inject a sample job end-to-end
│  │
│  ├─ mcp-server/                    # ★ interactive path — MCP tools
│  │  └─ src/
│  │     ├─ index.ts                 # Express: POST /mcp (Streamable HTTP), GET /events (SSE)
│  │     ├─ stdio.ts                 # stdio transport for Claude Desktop
│  │     ├─ server.ts                # build server + register tools + standing instructions
│  │     ├─ tools.ts                 # the 12 MCP tool definitions
│  │     ├─ events.ts                # in-memory live event bus (SSE)
│  │     └─ verify-*.ts              # smoke tests for the HTTP / stdio servers
│  │
│  ├─ visualiser/                    # ★ Next.js display layer (:4004)
│  │  ├─ app/
│  │  │  ├─ page.tsx                 # renders <CognitiveMirror/>
│  │  │  └─ api/*/route.ts           # same-origin proxies to graph-core/daemon/mcp/Ollama
│  │  ├─ components/CognitiveMirror.tsx  # the React HUD
│  │  ├─ lib/engine.ts               # Three.js knowledge-sphere engine
│  │  ├─ lib/services.ts             # service URLs + getJson() + embed()
│  │  └─ design/                     # provenance: original prototype + brief + screenshots
│  │
│  ├─ browser-extension/youtube/     # MV3 extension: capture the current YouTube video
│  └─ tunnel/                        # Cloudflare tunnel config (stub — see TODO.md)
│
├─ scripts/
│  ├─ up.sh                          # start the whole stack with one command
│  └─ down.sh                        # stop everything (services + Docker)
│
├─ docker-compose.yml                # FalkorDB + Ollama (127.0.0.1 only)
├─ package.json                      # workspace scripts (up/down/dev/dev:all/reset/…)
├─ pnpm-workspace.yaml               # workspace members
├─ tsconfig.base.json                # shared TS config
├─ .env.example                      # documented env template
├─ README.md  ·  TODO.md  ·  documentation.md
```

★ = a runnable service.

---

## 6. Local setup — step by step

### Prerequisites

- **Docker** — runs FalkorDB (graph + vectors) and Ollama (embeddings) as containers. Chosen so
  you don't install/native-build a graph database or embedding server on your host.
- **Node ≥ 22** — the runtime; also provides the built-in `node:sqlite` used by the queue.
- **pnpm 9** — the package manager that drives the monorepo workspace.

### Steps

```bash
# 1. Configure secrets & options. .env.example documents every variable.
cp .env.example .env
#    Fill ANTHROPIC_API_KEY (enrichment/brief/maintenance/research) and GITHUB_TOKEN
#    (commit polling). On macOS you can instead store them in Keychain (see config.ts).

# 2. Install all workspace dependencies (one lockfile for every package).
pnpm install

# 3. Start everything with one command.
pnpm up
```

`pnpm up` ([scripts/up.sh](scripts/up.sh)) does, in order:

1. `docker compose up -d` — starts **FalkorDB** (port 6379, Browser UI 3001) and **Ollama**
   (11434), both bound to `127.0.0.1`.
2. Waits for **FalkorDB** to answer `PING` and **Ollama** to answer `/api/tags`.
3. Pulls the embedding model into Ollama **on first run only** (idempotent).
4. Runs `pnpm dev:all` — all backend services **and** the visualiser, via `concurrently`.

Then open **http://127.0.0.1:4004** for the Cognitive Mirror UI. Press **Ctrl-C** to stop the app
services (Docker keeps running; use `pnpm down` to stop that too).

### Optional: end-to-end smoke test

```bash
pnpm seed          # injects a sample artifact → enrich job → Source + Concepts in the graph
```

### Connecting a Claude client

- **Claude Desktop** (local, no tunnel/OAuth) — see
  [apps/mcp-server/CLAUDE_DESKTOP.md](apps/mcp-server/CLAUDE_DESKTOP.md). The Desktop app launches
  `src/stdio.ts` as a subprocess and gets all 12 tools.
- **claude.ai web / mobile** — requires the Cloudflare tunnel + MCP OAuth, which are **not yet
  built** (see [TODO.md](TODO.md)).

---

## 7. Scripts explained

### Shell scripts (`scripts/`)

| Script | What it does |
|---|---|
| [`scripts/up.sh`](scripts/up.sh) | **Start the entire stack, one command.** Brings up Docker (FalkorDB + Ollama), waits for both to be healthy, pulls the embed model on first run, then runs all backend services + the visualiser in the foreground. Ctrl-C stops the app services; Docker stays up. |
| [`scripts/down.sh`](scripts/down.sh) | **Stop everything.** Kills whatever holds ports 4001–4005, then tears down the `concurrently` + `pnpm` supervisor tree (so it works even when the stack was detached), then `docker compose down`. **Data is preserved** (named volumes + `.data/` untouched). |

### `package.json` scripts (run with `pnpm <name>`)

| Script | Purpose |
|---|---|
| `up` | `bash scripts/up.sh` — start the whole stack. |
| `down` | `bash scripts/down.sh` — stop the whole stack. |
| `db:up` / `db:down` | Start / stop **only** the Docker data plane. |
| `setup:ollama` | Pull the embedding model into the Ollama container. |
| `dev` | Backend services only (graph-core, ingestion, daemon, mcp) via `concurrently` — no visualiser. |
| `dev:all` | All backend services **+ visualiser** (what `pnpm up` runs after infra is ready). |
| `seed` | Inject a sample ingestion job end-to-end. |
| `reset` | **Wipe local data**: clears the FalkorDB graph, the queue (`.data/queue.sqlite*`), and the budget state (`.data/budget.json`). |
| `build` | `pnpm -r build` — tsup-build every package. |
| `typecheck` | `pnpm -r typecheck` — `tsc --noEmit` across the workspace. |
| `test` | `pnpm -r test` — vitest across the workspace. |

### Per-service scripts (run with `pnpm --filter <pkg> <script>`)

| Command | Purpose |
|---|---|
| `--filter @cm/reasoning-daemon brief` | Run the daily world brief **once, now**. |
| `--filter @cm/reasoning-daemon maintain` | Run nightly maintenance **once, now**. |
| `--filter @cm/ingestion kindle <path>` | Import Kindle highlights from `My Clippings.txt`. |
| `--filter @cm/ingestion repos` | One-shot import of every GitHub repo you own (README + metadata → Concepts). `--no-archived` to skip archived. |
| `--filter @cm/graph-core reset` | Wipe just the FalkorDB graph. |
| `--filter @cm/mcp-server stdio` | Run the stdio MCP server (what Claude Desktop launches). |
| `--filter @cm/visualiser dev` | Run just the visualiser against an already-running backend. |

---

## 8. Configuration (environment variables)

All config is centralised and **zod-validated** in
[packages/shared/src/config.ts](packages/shared/src/config.ts). Secrets fall back to the macOS
Keychain when the env var is absent. File-state paths (`QUEUE_DB_PATH`, `BUDGET_STATE_PATH`) are
anchored to the repo root so every service shares one file regardless of its working directory.

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — (or Keychain) | Anthropic API key for the daemon. |
| `GITHUB_TOKEN` | — (or Keychain) | Token for commit polling. |
| `GITHUB_REPOS` | `""` | Comma-separated `owner/repo` list to poll. |
| `GITHUB_POLL_INTERVAL_MS` | `300000` | Poll cadence (5 min). |
| `FALKORDB_HOST` / `FALKORDB_PORT` | `127.0.0.1` / `6379` | FalkorDB connection. |
| `FALKORDB_GRAPH` | `cognitive_mirror` | Graph key name. |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama endpoint. |
| `EMBED_MODEL` / `EMBED_DIM` | `nomic-embed-text` / `768` | Embedding model + vector dimension. |
| `CHUNK_TOKENS` / `CHUNK_OVERLAP` | `512` / `64` | Content-chunk size + overlap (≈4 chars/token). |
| `GRAPH_CORE_PORT` … `DAEMON_PORT` | `4001`–`4005` | Service ports (all `127.0.0.1`). |
| `MODEL_ENRICH` | `claude-haiku-4-5-20251001` | Enrichment tier (cheap, high-volume). |
| `MODEL_ADJUDICATE` | `claude-sonnet-4-6` | Adjudication / brief / research / synthesis tier. |
| `MODEL_INSIGHT` | `claude-opus-4-8` | Cross-domain insight tier (the marquee output). |
| `DAILY_BUDGET_USD` / `MONTHLY_BUDGET_USD` | `5` / `100` | Circuit-breaker caps. |
| `MODEL_PRICES` | `""` (JSON) | Per-model USD/Mtok prices; absent → cost counted as 0. |
| `QUEUE_DB_PATH` | `./.data/queue.sqlite` | Durable queue location. |
| `BUDGET_STATE_PATH` | `./.data/budget.json` | Persisted budget state. |
| `INGEST_TOKEN` | `""` | Bearer token for the ingestion webhook (empty = open, local dev). |
| `NTFY_URL` / `NTFY_TOPIC` | `https://ntfy.sh` / `""` | Push alerts (empty topic = disabled). |
| `BRIEF_THRESHOLD` | `0.45` | Max cosine **distance** to keep a brief candidate. |
| `BRIEF_MAX_OBSERVATIONS` | `5` | Max observations synthesised per brief. |
| `BRIEF_CRON` | `0 7 * * *` | Daily brief schedule (07:00). |
| `ARXIV_CATEGORIES` / `RSS_FEEDS` | `cs.AI,cs.LG,cs.CL` / `""` | Brief feed inputs. |
| `MAINTENANCE_CRON` | `30 3 * * *` | Nightly maintenance schedule (03:30). |
| `MERGE_CANDIDATE_DISTANCE` | `0.3` | Stage-1 merge gate cosine-distance threshold. |
| `MAX_INSIGHTS_PER_RUN` | `3` | Cap on cross-domain insights per run. |
| `ARCHIVE_INACTIVITY_DAYS` | `30` | Archive stale nodes after N inactive days. |
| `HEALTH_INTERVAL_MS` | `120000` | Daemon self-health probe interval. |

> Note on thresholds: FalkorDB's cosine score is a **distance** (lower = closer). The thresholds
> here are calibrated for `nomic-embed-text`, not the design doc's similarity figures.

---

## 9. Features in depth

### 9.1 Ingestion — capture everything, durably

The ingestion service ([apps/ingestion](apps/ingestion)) is dumb on purpose: it **does no
reasoning**. It authenticates, hashes, and enqueues.

- **Webhook** (`POST /ingest`) accepts manual sources: `note`, `journal`, `youtube`,
  `kindle_highlight`, `github_repo`, `generic`. A `Bearer`/`?token=` must match `INGEST_TOKEN` if set.
- **GitHub repos** is a one-shot CLI import (`pnpm --filter @cm/ingestion repos`,
  [import-repos.ts](apps/ingestion/src/import-repos.ts)): discovers every repo you own via the
  GitHub API and posts each repo's README + description + language + topics as a `github_repo`
  Source — so the daemon distils what each project is and finds cross-repo connections.
- **GitHub poller** fetches new commits for `GITHUB_REPOS` every `GITHUB_POLL_INTERVAL_MS`.
- **Brief sources** (ArXiv/RSS/GitHub-trending) are pulled by the **daemon**, not this webhook.
- **Kindle** is a CLI import (`pnpm --filter @cm/ingestion kindle <file>`).

**Idempotency:** every job carries a `content_hash` (of `kind + source + text`), and the queue's
`content_hash` column is `UNIQUE`. Re-seeing the same artifact (e.g. the 5-minute GitHub poll) is a
no-op, not a duplicate enrichment. ([packages/queue/src/index.ts](packages/queue/src/index.ts))

**Durability & retries:** the queue is `node:sqlite` on disk, so captured work survives restarts
and API/internet outages. Jobs are leased atomically (`BEGIN IMMEDIATE`), and `fail()` retries with
**exponential backoff** (`5s · 2^(attempt-1)`) up to `maxAttempts` (5) before marking `failed`.

### 9.2 Enrichment — artifact → graph

The daemon's worker leases a job and, for an `enrich` job, runs
[enrich.ts](apps/reasoning-daemon/src/enrich.ts):

1. Calls Claude (**Haiku** tier) to distil the artifact into `{ source, concepts[], relations[] }`
   — strictly JSON, parsed defensively with a source-only fallback so the pipeline never stalls.
2. Builds **one atomic batch** of ops: a `Source` node, 1–6 `Concept` nodes, `MENTIONS` edges
   (source→concept), `RELATES_TO` edges (concept↔concept), a **summary embedding** for the source
   and each concept, and **content-chunk** embeddings for retrieval.
3. Writes the whole batch through `graph.execute(...)` (single writer, one op-log entry).
4. Enqueues a debounced (hourly) `maintenance` job so the graph re-settles after new material.

### 9.3 Embeddings — two roles, one model

[packages/embeddings](packages/embeddings) provides `embed()` and `chunkText()`, used on both the
write side (daemon) and the query side (MCP). Two embedding **roles** (design §11), both from the
same Ollama model so the vector index dimension is consistent:

- **Summary embedding** (`Node.summary_embedding`) — one per knowledge node, powers semantic
  search and the merge gate.
- **Content-chunk embedding** (`Chunk.embedding`) — overlapping ~512-token chunks of a source's
  full text, powers grounded answer retrieval (`search_chunks`). Chunking is character-based
  (~4 chars/token) with `CHUNK_OVERLAP` overlap.

### 9.4 Information retrieval

Four ways to get knowledge out ([repo.ts](apps/graph-core/src/repo.ts)):

- **Semantic search** (`search_semantic`) — vector kNN over `Node.summary_embedding`, filters
  archived nodes, optional type filter. The "by meaning" path.
- **Keyword search** (`search_text`) — full-text over `title`+`summary`, the lexical complement
  for exact terms, names, acronyms a vector misses. User input is sanitized of RediSearch
  operators before querying.
- **Chunk retrieval** (`search_chunks`) — vector kNN over `Chunk.embedding`, returns the raw text
  passages to ground an answer with citations.
- **Traversal** (`traverse_from`) — N-hop neighbourhood from a node (excludes archived).

Reads bump `touchCount`/`lastReadAt` (fire-and-forget) so the daily brief can weight recently-read
concepts as "hotter".

### 9.5 The maintenance engine — the graph self-manages

Runs nightly (cron) and, debounced, after each ingestion. Implemented in
[maintenance/index.ts](apps/reasoning-daemon/src/maintenance/index.ts), backed by read queries in
[graph-core/maintenance.ts](apps/graph-core/src/maintenance.ts). See §12 for the full logic. In
brief, one pass does:

1. **Merge / contradiction gate** (two stages) over near-duplicate concept pairs.
2. **Contradiction synthesis** — a `Synthesis` node reconciling a contradicting pair.
3. **Cross-domain insight detection** — the marquee output: an `Insight` from two related concepts
   in *different* domains (**Opus** tier).
4. **Archival** — time-decay soft-delete of stale `Conversation`/`WorldEvent` nodes.

Every destructive op goes through `executeOps` and is recorded in the op log with a **24h undo
window**.

**Edited-note approval gate (§9 human-in-the-loop):** the merge gate and archival are autonomous
for ordinary nodes, but when a proposed **merge** or **archival-delete** would touch a node the user
has hand-**edited** (`edited = true`, set by a UI edit), the engine does **not** act. Instead it
records the fully-formed ops as a `:Approval` proposal ([approvals.ts](apps/graph-core/src/approvals.ts))
for the user to **Allow** or **Reject** from the visualiser. Approving replays the stored ops through
`executeOps` (no further LLM call); rejecting cools the subject nodes down (`mergeCooldownUntil` /
`cleanupRejectedUntil`) so the same action isn't re-proposed for 24h. Proposals are deduped by
action + subject set so a nightly run can't spam them.

### 9.6 Daily world brief

[brief.ts](apps/reasoning-daemon/src/brief.ts): pull ArXiv + RSS + GitHub-trending, embed each
candidate, score it against your existing `Concept`/`Interest` vectors (with a recency boost for
concepts read in the last week), discard the irrelevant (distance > `BRIEF_THRESHOLD`), and have
Claude (**Sonnet**) synthesise up to `BRIEF_MAX_OBSERVATIONS` non-obvious observations into
`WorldEvent` nodes — each tied to the existing concept it resembles.

### 9.7 Live web research

[research.ts](apps/reasoning-daemon/src/research.ts) + the `research_topic` MCP tool: Claude
(**Sonnet**) researches a topic with the Anthropic **web search** server tool, and the cited
briefing flows through the **same enrichment pipeline** as any other source — producing a `Source`
node + extracted `Concept`s + embeddings, with citation URLs preserved.

### 9.8 Budget breaker (persistent)

[budget.ts](apps/reasoning-daemon/src/budget.ts): a circuit breaker checked before every
non-essential API call. Spend is **write-through persisted** to `BUDGET_STATE_PATH`, so the breaker
survives daemon restarts (it can't be reset just by bouncing the process). Enforces both a **daily**
and a **monthly** cap with UTC rollovers; when tripped, the worker pauses enrichment and (if
configured) fires an ntfy alert. Prices come from `MODEL_PRICES` — absent prices count as $0 (tokens
still tracked) so the breaker simply won't trip until prices are configured.

### 9.9 Atomic writes, op log, undo

[execute.ts](apps/graph-core/src/execute.ts): FalkorDB only guarantees atomicity **within** a single
Cypher query, and some ops (tombstone/merge) are inherently multi-statement — so a batch can't be one
transaction. Instead each sub-op is applied with a **compensating inverse**; if any sub-op throws,
the inverses collected so far run in reverse to undo the partial batch, and the error is rethrown so
callers fail fast. The batch is **all-or-nothing as observed by callers**. (The one best-effort case:
edges re-pointed onto a survivor during a merge are not un-pointed on rollback — matching the 24h
undo's documented limitation.)

The **op log** ([oplog.ts](apps/graph-core/src/oplog.ts)) records one entry per batch; destructive
batches (softDelete/tombstone) get a 24-hour `undoUntil`. `undoOpLog` reverses them within the
window.

### 9.10 Cooperative conversation capture & resurfacing

The MCP server instructs Claude to call `checkpoint_conversation` at each semantic breakpoint (a
sub-topic closing) and `close_conversation` at the end. Deltas accumulate on a `Conversation` node,
so an abrupt ending loses at most the last segment. At a new session start, `get_resurfacing`
returns 1–2 open loops ranked by **recency × activity** so Claude can offer to continue/park/close
them.

### 9.11 Visualiser

[apps/visualiser](apps/visualiser): a Next.js app whose `app/api/*` routes proxy the localhost-only
services (browser stays same-origin; graph-core/daemon/mcp are never exposed). It renders a Three.js
knowledge sphere from `/api/graph`, animates live reasoning traces from the MCP SSE stream via
`/api/events`, and drives the Daily Brief / vitals / open loops / op log / status panels from the
graph-core + daemon endpoints. Every panel degrades gracefully if a service is down.

### 9.12 Editing & curation (interactive)

The visualiser is not read-only: notes are first-class objects you can manage.
- **Markdown** — card/summary text renders as GitHub-flavoured markdown (`react-markdown` +
  `remark-gfm`, themed via `.cm-md` in `globals.css`).
- **Delete** — every card (brief notes, the node-detail card, the type-list rows) has a trash
  button → `DELETE /api/node/:id` → **soft-delete** (archive), hidden from the UI + sphere but
  restorable via the op-log undo. The sphere reconciles by reloading the graph snapshot.
- **Edit + preview** — the node-detail card has an **Edit** mode (title input + markdown textarea)
  with a live **Preview** toggle and **Save** → `PATCH /api/node/:id`, which marks the node
  `edited` and **re-embeds** the new summary so semantic search and the merge gate stay consistent.
- **Browse by type** — the status-bar vitals (Concepts / Insights / Syntheses / World Events) open
  a list panel (`/api/nodes?type=`); rows open the detail card or delete inline.
- **Approvals** — pending cleanup proposals (see §9.5) surface as cards atop the brief panel with
  Allow / Reject.

The `edited` flag is the hinge between this section and §9.5: editing a note marks it, and that mark
is what makes the maintenance engine ask permission before merging or deleting it.

---

## 10. API endpoints

All services bind to `127.0.0.1` only.

### graph-core — Core Graph Service (`:4001`) · [api.ts](apps/graph-core/src/api.ts)

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness. |
| `GET /node/:id` | A node with its properties + outgoing edges (bumps read-recency). |
| `POST /search/semantic` | Vector kNN over summary embeddings. Body: `{ embedding, k?, type? }`. |
| `POST /search/text` | Full-text keyword search. Body: `{ query, k?, type? }`. |
| `POST /search/chunks` | Vector kNN over content chunks. Body: `{ embedding, k? }`. |
| `POST /traverse` | N-hop traversal. Body: `{ id, depth?, limit? }`. |
| `POST /execute` | **The sole write path.** Body: `{ ops[], reason? }` → `{ opLogId, results }`. |
| `GET /oplog?limit=` | Recent op-log entries. |
| `GET /maintenance/merge-candidates?max=` | Stage-1 near-duplicate concept pairs. |
| `GET /maintenance/cross-domain` | Cross-domain related concept pairs. |
| `GET /maintenance/resurface?limit=` | Open conversation loops, ranked. |
| `GET /stats/counts` | Active node counts by type. |
| `GET /graph?limit=` | Whole-graph snapshot for the visualiser. |
| `GET /nodes?type=&limit=` | Active nodes of a type with degree. |
| `POST /maintenance/undo` | Reverse a destructive batch within its window. Body: `{ opLogId }`. |
| `GET /approvals` | Pending cleanup approvals awaiting the user (edited-note merges/deletes). |
| `POST /approvals` | Record a proposal (used by the daemon). Body: `{ action, title, detail, ops, subjectIds }`. |
| `POST /approvals/:id/resolve` | Allow or reject a proposal. Body: `{ decision: "approve" \| "reject" }`. |

### ingestion (`:4002`) · [server.ts](apps/ingestion/src/server.ts)

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness. |
| `GET /stats` | Queue stats (`queued/leased/done/failed`). |
| `POST /ingest` | Enqueue a captured artifact. Auth: `Bearer INGEST_TOKEN` if set. |

### reasoning-daemon (`:4005`) · [status-server.ts](apps/reasoning-daemon/src/status-server.ts)

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness. |
| `GET /status` | `{ budget: snapshot, queue: stats }`. |
| `POST /research` | Run live web research → graph. Body: `{ topic }`. |

### mcp-server (`:4003`) · [index.ts](apps/mcp-server/src/index.ts)

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness. |
| `GET /events` | **SSE** live event stream (`node_read` / `search` / `traverse` / `write`). |
| `POST /mcp` | MCP over Streamable HTTP (stateless: fresh server+transport per request). |
| `GET`/`DELETE /mcp` | `405` — not allowed. |

Plus a **stdio** transport ([stdio.ts](apps/mcp-server/src/stdio.ts)) for Claude Desktop.

### visualiser (`:4004`) — same-origin proxies under `app/api/`

`brief`, `concepts`, `events`, `graph`, `loops`, `nodes`, `node/[id]`, `oplog`, `research`,
`search`, `status`, `vitals`, `approvals`, `approvals/[id]/resolve` — each proxies the corresponding
graph-core/daemon/mcp/Ollama call so the browser never talks to the backends directly.
`node/[id]` also handles `DELETE` (soft-delete) and `PATCH` (edit: re-embeds the new summary via
Ollama, then writes `updateNode` + `setSummaryEmbedding`, marking the node `edited`).

---

## 11. MCP functions (tools)

12 tools, registered in [tools.ts](apps/mcp-server/src/tools.ts). Read tools emit live events;
write tools go through `graph.execute` (the single writer).

| Tool | Kind | Inputs | What it does |
|---|---|---|---|
| `search_semantic` | read | `query, k?, type?` | Semantic (vector) search by meaning over knowledge nodes. |
| `search_text` | read | `query, k?, type?` | Keyword (full-text) search — exact terms, names, acronyms. |
| `search_chunks` | read | `query, k?` | Retrieve the most relevant source **content chunks** to ground an answer. |
| `get_node` | read | `id` | Fetch a node by id with properties + outgoing edges. |
| `traverse_from` | read | `id, depth?, limit?` | Traverse the graph up to N hops from a node. |
| `get_resurfacing` | read | `limit?` | 1–2 open conversation loops worth resurfacing (recency × activity). |
| `research_topic` | write | `topic` | Live web research → notes (Source + Concepts + citations). Calls the daemon. |
| `create_concept` | write | `title, summary, domain?` | Create a `Concept` (with summary embedding). |
| `create_interest` | write | `title, summary` | Bootstrap an `Interest` domain to score world-signal against. |
| `relate_nodes` | write | `from, to, type` | Create a typed edge between two existing nodes. |
| `checkpoint_conversation` | write | `conversationId?, delta, openQuestions?, conclusions?` | Open/append a `Conversation` at a semantic breakpoint. |
| `close_conversation` | write | `conversationId, status` | Finalise a conversation (`closed`/`parked`) + compute its summary embedding. |

The server ships **standing instructions** ([server.ts](apps/mcp-server/src/server.ts)) telling
Claude to ground answers in the graph (cite node titles) and to checkpoint conversations.

---

## 12. Core logic: consolidation, merges, retrieval

### 12.1 Consolidation / merges — the two-stage gate

The design principle: **vector similarity nominates, the LLM decides.** A vector index is good at
"these two summaries are close" but bad at "are these the *same idea*, *opposed*, or merely
*related*?" So merging is two stages
([graph-core/maintenance.ts](apps/graph-core/src/maintenance.ts) +
[maintenance/index.ts](apps/reasoning-daemon/src/maintenance/index.ts)):

**Stage 1 — nominate (cheap, vector).** `mergeCandidates(maxDistance)` is a vector self-join over
the `Concept` summary embeddings: for each active concept, its nearest concept neighbours within
`MERGE_CANDIDATE_DISTANCE` become candidate pairs. The query:
- dedupes each unordered pair to one row (`node.id < c.id`),
- skips archived nodes and nodes inside a **merge cooldown** (`mergeCooldownUntil`, set on a
  survivor for 24h after a merge so it isn't immediately re-merged),
- orders by ascending distance (closest first).

**Stage 2 — adjudicate (LLM, the real decision).** For each candidate pair (skipping any node
already touched this pass), `adjudicatePair` asks Claude (**Sonnet**) for a verdict — and acts:

| Verdict | Action |
|---|---|
| **merge** | Update the survivor with a merged title/summary + new embedding, **tombstone** the loser (re-point its edges onto the survivor, relabel it `:Tombstone`, set `MERGED_INTO`, cool down the survivor 24h). |
| **contradiction** | Add a `CONTRADICTS` edge, then synthesise a `Synthesis` node (`synthesizeContradiction`) naming the shared ground, the divergence, and resolving questions, with `DERIVED_FROM` edges to both. |
| **related** | Add a `RELATES_TO` edge with the reason. |
| **distinct** | Do nothing (no edge). |

The prompt is deliberately **conservative about merge** — only when two concepts are truly the same.

**Cross-domain insight detection** (the marquee output): `crossDomainEdges` finds `RELATES_TO`
pairs whose endpoints have *different* domains and that don't already feed an `Insight`. For the top
`MAX_INSIGHTS_PER_RUN`, `synthesizeInsight` (**Opus**) names the deep structural parallel — or
returns an empty title if the connection is shallow, in which case nothing is written.

**Archival** (time-decay): `pruneArchival` soft-deletes stale `Conversation`/`WorldEvent` nodes
inactive longer than `ARCHIVE_INACTIVITY_DAYS`, **unless** they're still open or well-connected
(degree ≥ 3). Archived ≠ deleted — it's restorable indefinitely (and undoable for 24h).

### 12.2 Information retrieval — why three paths

A single retrieval method has blind spots, so the system offers complementary ones and lets Claude
(or the brief/maintenance logic) pick:

- **Semantic** answers "what do I know *about this idea*" even when wording differs — but can miss
  exact tokens and conflate near-but-distinct things.
- **Keyword/full-text** nails exact terms, names, acronyms, identifiers — the things a vector
  blurs. It's the lexical complement, backed by the FalkorDB full-text index.
- **Chunk retrieval** returns the *actual passages* (not just node summaries) so an answer can be
  grounded and cited against the original text.
- **Traversal** follows the explicit structure (`RELATES_TO`, `CONTRADICTS`, `DERIVED_FROM`,
  `MENTIONS`) to expand from a hit into its neighbourhood.

All vector queries use FalkorDB's `db.idx.vector.queryNodes`, whose score is a **cosine distance**
(lower = closer); thresholds throughout are tuned to `nomic-embed-text`. Reads update read-recency
so that "hot" concepts get a boost when the daily brief scores fresh world signal — closing the loop
between what you retrieve and what the system surfaces to you next.

### 12.3 Why a single writer + op log

Both reasoning paths could race on the graph. Funnelling **every** mutation through graph-core's
`executeOps` gives one serialization point, one op-log entry per batch, atomic (compensated) batches,
and a uniform 24h undo for anything the autonomous engine does on its own — which is what makes it
safe to let the graph rewrite itself while you sleep.

---

*Generated as a living reference. When behaviour changes, update this file alongside the code.*
