# mcp-server — the interactive path

Exposes the graph to Claude as MCP tools, two ways:

- **stdio** (`src/stdio.ts`) — what Claude Desktop launches as a subprocess.
  Nothing listens on a port; no traffic leaves the machine. This is the
  recommended path. See [CLAUDE_DESKTOP.md](CLAUDE_DESKTOP.md).
- **Streamable HTTP** (`src/index.ts`) on `127.0.0.1:4003` — for the visualiser's
  event stream, and for claude.ai on web/mobile via a tunnel.

## Tools

Read: `search_semantic`, `search_text`, `search_chunks`, `get_node`,
`traverse_from`, `get_resurfacing`.

Write: `create_concept`, `create_interest`, `relate_nodes`, `research_topic`.

Conversation capture: `checkpoint_conversation`, `close_conversation` — so a chat
that touches durable ideas lands in the graph without being retyped.

Writes go through [graph-core](../graph-core), never directly to the database.

## Authentication

Off by default, because by default nothing can reach this but your own machine.

Setting `MCP_PUBLIC_URL` turns on the OAuth 2.1 authorization server in
`src/auth/` **and makes it mandatory** — the process refuses to start without
`MCP_AUTH_PASSPHRASE_HASH`, and refuses a non-`https` URL.

The server binds loopback and so cannot tell a tunnelled request from a local
one; by the time cloudflared forwards it, it looks local. `MCP_PUBLIC_URL` is
therefore a statement of intent, and everything keys off it. Failing to boot is
loud; quietly serving an unauthenticated write API to the internet is not.

| | |
|---|---|
| `auth/provider.ts` | The `OAuthServerProvider`: codes, tokens, rotation, revocation |
| `auth/store.ts` | `node:sqlite` persistence — tokens stored only as SHA-256 hashes |
| `auth/login.ts` | The consent screen |
| `auth/passphrase.ts` | scrypt hashing for the single-user passphrase |

Setup, the Cloudflare Access policy, and the rotation runbook:
[apps/tunnel/README.md](../tunnel/README.md).
