# Cognitive-mirror

A local-first "second brain" PKM: it ingests your activity (GitHub commits today; notes,
conversations, and more later), distils it into a self-managing knowledge graph, and lets
Claude reason over it two ways:

- **Interactive path** — a Claude client talks to the **MCP server** (read / guided-write tools).
- **Autonomous path** — a **reasoning daemon** calls the Anthropic API directly and writes to the
  graph through the single-writer **Core Graph Service** (never through MCP).

Knowledge data lives only on your machine. See `pkm_revised_architecture_and_plan_latest.md` for
the full design.

## Stack (current / supported, June 2026)

| Concern | Choice | Notes |
|---|---|---|
| Graph + vectors | **FalkorDB** (Docker) | Replaces Kuzu (archived Oct 2025) **and** Qdrant; native Cypher + vector index |
| Embeddings | **Ollama** `nomic-embed-text` | 768-dim; config-driven model/dim |
| Interactive reasoning | **MCP** `@modelcontextprotocol/sdk` v1 | Streamable HTTP, localhost (tunnel + OAuth later) |
| Autonomous reasoning | **`@anthropic-ai/sdk`** | Haiku/Sonnet/Opus tiering |
| Durable queue | **better-sqlite3** | Ingestion survives outages |
| HTTP | **Hono** | graph-core internal API, ingestion webhooks |

## Layout

```
packages/shared        — schema, GraphOp types, config, logger, keychain
packages/graph-client  — typed client to the Core Graph Service
apps/graph-core        — ★ Core Graph Service: single writer, owns FalkorDB
apps/reasoning-daemon  — ★ autonomous path: API client, enrichment, embeddings, budget
apps/mcp-server        — ★ interactive path: MCP tools + live event stream
apps/ingestion         — ★ durable queue + GitHub poller (idempotent)
apps/tunnel            — Cloudflare tunnel config (Phase 0 stub)
apps/visualiser        — Next.js (Phase 4 stub; design import target)
```
★ = implemented (Phase 1 "Spine"). Others are scaffold/stubs.

## Quick start (local dev)

```bash
cp .env.example .env            # fill ANTHROPIC_API_KEY and GITHUB_TOKEN
pnpm install
pnpm db:up                      # FalkorDB + Ollama in Docker
pnpm setup:ollama               # pull the embedding model
pnpm dev                        # graph-core, ingestion, daemon, mcp-server
pnpm seed                       # inject a sample ingestion job end-to-end
pnpm test
```

See the approved plan for the full Phase-1 verification walkthrough.
