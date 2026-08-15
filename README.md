<div align="center">

# Cognitive-mirror

**A second brain that manages itself.** It ingests what you read, write, and
build; distils it into a knowledge graph; and keeps that graph tidy on its own
schedule. Claude reasons over it. Everything stays on your machine.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/eternalAbyss/Cognitive-mirror/actions/workflows/ci.yml/badge.svg)](https://github.com/eternalAbyss/Cognitive-mirror/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/cognitive-mirror.svg)](https://www.npmjs.com/package/cognitive-mirror)

```bash
npx cognitive-mirror@latest init
npx cognitive-mirror@latest up
```

</div>

## What it actually does

Most note tools are filing cabinets: you put things in, and they stay exactly
where you left them. This one has a background process that reads what you've
captured, decides what it means, and reorganises accordingly.

Concretely, on its own schedule it will:

- **Distil** each captured artifact into durable concepts — not a summary of the
  article, but the reusable ideas in it.
- **Notice** that two concepts you wrote about weeks apart are the same thing,
  and merge them.
- **Notice** that two of your notes contradict each other, and record the
  contradiction rather than silently keeping both.
- **Connect** ideas across unrelated domains. The visualiser draws these as gold
  arcs spanning the sphere rather than hugging a cluster, and they are the point
  of the whole thing.
- **Resurface** an open question you left three weeks ago, when something new
  connects to it.

And every morning it writes you a brief: what arrived overnight from arXiv, RSS,
and GitHub trending, scored against what you actually care about rather than
what's popular.

## How it's put together

Two paths reach the same graph, deliberately kept apart:

```
   YOU                                              CLAUDE
    │                                                  │
    │  commits, notes, highlights,                     │  "what does my graph
    │  videos, journal entries                         │   say about X?"
    ▼                                                  ▼
┌─────────────┐      ┌──────────────┐          ┌──────────────┐
│  ingestion  │─────▶│ durable queue│          │  MCP server  │  12 tools
│   :4002     │      │  (sqlite)    │          │    :4003     │  read + guided write
└─────────────┘      └──────┬───────┘          └──────┬───────┘
                            │                          │
                            ▼                          │
                  ┌───────────────────┐                │
                  │ reasoning daemon  │                │
                  │      :4005        │  enrichment,   │
                  │                   │  daily brief,  │
                  │  Anthropic API    │  nightly       │
                  └─────────┬─────────┘  maintenance   │
                            │                          │
                            ▼                          ▼
                     ┌──────────────────────────────────┐
                     │      graph service :4001         │  ← the only writer
                     │  batched, all-or-nothing, logged │
                     └────────────────┬─────────────────┘
                                      ▼
                            ┌──────────────────┐
                            │    FalkorDB      │  graph + vector index
                            └──────────────────┘
                                      ▲
                            ┌─────────┴────────┐
                            │  visualiser :4004│
                            └──────────────────┘
```

The **autonomous path** (daemon) never goes through MCP, and the **interactive
path** (MCP) never writes to the database directly. Both funnel through one
service that owns FalkorDB, applies batches with compensating inverses so a
partial failure rolls back, and records every mutation in an op log with a
24-hour undo window.

## Getting started

You need **Docker** (for FalkorDB and Ollama) and **Node 22+**. An Anthropic API
key is optional — ingestion, search, and the visualiser work without one; the
reasoning does not.

```bash
npx cognitive-mirror@latest init     # writes ~/.cognitive-mirror/.env
npx cognitive-mirror@latest up       # data plane + all services + the UI
```

Then open <http://127.0.0.1:4004>.

If something doesn't come up, `cognitive-mirror doctor` will tell you what's
missing rather than making you guess.

| Command | |
|---|---|
| `init` | Create the config directory and `.env` |
| `doctor` | Check prerequisites and report what's missing |
| `up` / `down` / `status` | Run, stop, inspect |
| `seed` | Load a few example nodes to look at |
| `import kindle <file>` | Import `My Clippings.txt` |
| `import repos` | Import your GitHub repositories |
| `reset` | Delete the whole graph and start over |
| `mcp` | The stdio MCP server, for Claude Desktop |
| `auth set-passphrase` | Set the login passphrase for remote access |
| `tunnel` | Publish the MCP endpoint via Cloudflare |

### Connect Claude

**Claude Desktop** is the recommended client — it launches the MCP server as a
local subprocess, so nothing listens on a port and no traffic leaves the machine.
Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "cognitive-mirror": { "command": "npx", "args": ["-y", "cognitive-mirror", "mcp"] }
  }
}
```

Details, including running from a clone: [apps/mcp-server/CLAUDE_DESKTOP.md](apps/mcp-server/CLAUDE_DESKTOP.md).

**claude.ai on web or mobile** needs the MCP endpoint to be reachable, which
means OAuth and a tunnel: [apps/tunnel/README.md](apps/tunnel/README.md). Read
[SECURITY.md](SECURITY.md) first — you are publishing an endpoint that can read
your journal.

### Feed it

| Source | How |
|---|---|
| GitHub commits | `GITHUB_TOKEN` + `GITHUB_REPOS` in `.env`, polled automatically |
| Notes & journal | Apple Shortcuts → the `/ingest` webhook ([SHORTCUTS.md](apps/ingestion/SHORTCUTS.md)) |
| YouTube | The MV3 browser extension in [apps/browser-extension](apps/browser-extension) |
| Kindle highlights | `cognitive-mirror import kindle "…/My Clippings.txt"` |
| arXiv / RSS / trending | Automatic, via the daily brief |

## What it costs

The daemon calls the Anthropic API; nothing else does. A budget breaker caps
spend at `DAILY_BUDGET_USD` (default $5) and `MONTHLY_BUDGET_USD` (default $100),
persists across restarts, and uses a built-in price table so it works without
configuration. Typical day-to-day use is cents, not dollars — the status bar
shows the running total.

Models are tiered by how much judgement the task needs: Haiku for enrichment,
Sonnet for adjudicating merges, Opus for cross-domain insights.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Graph + vectors | **FalkorDB** | One store for both. Cypher plus a native vector index, so there's no second database to keep in sync. |
| Embeddings | **Ollama** (`nomic-embed-text`) | Local, so your notes aren't sent anywhere to be indexed. |
| Reasoning | **Anthropic API** | Haiku / Sonnet / Opus, tiered by task. |
| Queue | **`node:sqlite`** | Built in — no native build step, which matters for an npm-installed CLI. |
| Interactive | **MCP** over stdio + HTTP | 12 tools; OAuth 2.1 when published. |
| UI | **Next.js + Three.js** | A WebGL sphere; see [apps/visualiser](apps/visualiser). |

## Layout

```
apps/cli               the `cognitive-mirror` command — the published package
apps/graph-core        ★ the sole writer: owns FalkorDB, op log, undo
apps/reasoning-daemon  ★ autonomous path: enrichment, brief, maintenance, research
apps/ingestion         ★ durable queue, GitHub poller, webhook
apps/mcp-server        ★ interactive path: MCP tools + OAuth 2.1
apps/visualiser        the WebGL knowledge sphere
apps/tunnel            off-device access via Cloudflare
apps/browser-extension YouTube capture (MV3)

packages/shared        schema, ops, config, logging
packages/graph-client  typed client for the graph service
packages/embeddings    Ollama embedding + chunking
packages/queue         the durable job queue
```

## Development

```bash
git clone https://github.com/eternalAbyss/Cognitive-mirror.git
cd Cognitive-mirror
pnpm install
cp .env.example .env       # add your API key
pnpm up                    # same as `cognitive-mirror up`, from the checkout
```

`pnpm lint`, `pnpm typecheck`, `pnpm test`. See
[CONTRIBUTING.md](CONTRIBUTING.md) — and
[docs/architecture.md](docs/architecture.md) for how the whole thing actually
works, in depth.

## Security & privacy

Your graph never leaves your machine unless you publish the MCP endpoint
yourself. Everything binds to `127.0.0.1`.

But a language model writes to this graph unsupervised, and that has real
consequences worth understanding before you trust it with your journal.
[SECURITY.md](SECURITY.md) sets out the trust model plainly — including what is
*not* protected.

## License

MIT — see [LICENSE](LICENSE).
