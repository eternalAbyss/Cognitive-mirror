# Off-device access

By default Cognitive-mirror is unreachable from anywhere but your own machine.
This is how to reach it from claude.ai on the web or your phone — and what has to
be true before you do.

You do not need this for **Claude Desktop**, which launches the MCP server as a
local subprocess over stdio. That path is strictly more private: nothing listens
on a port and nothing crosses the network. See
[`../mcp-server/CLAUDE_DESKTOP.md`](../mcp-server/CLAUDE_DESKTOP.md).

## What you're exposing

The MCP endpoint can read every node in your graph and write new ones. Treat the
passphrase below as equivalent to your journal.

Three things stand between the internet and that endpoint, and you should have
all three:

1. **OAuth 2.1** on the MCP server — the topic of most of this page.
2. **A Cloudflare tunnel** — outbound-only, so no router port is opened and your
   home IP is never published.
3. **A Cloudflare Access policy** — a second, independent gate in front of the
   tunnel, so a bug in (1) is not the only thing protecting you.

## Setup

### 1. Set a passphrase

```bash
cognitive-mirror auth set-passphrase
```

This writes a scrypt hash to `MCP_AUTH_PASSPHRASE_HASH` in your `.env`. The
passphrase itself is never stored. Use a long one — it is the only secret in the
authorisation flow, and it is reachable from the public internet once the tunnel
is up.

### 2. Point `MCP_PUBLIC_URL` at a hostname you control

```bash
# in your .env
MCP_PUBLIC_URL=https://mcp.example.com
```

Setting this is what **turns OAuth on**. It also makes it mandatory: with
`MCP_PUBLIC_URL` set and no passphrase hash, the MCP server refuses to start
rather than serving an unauthenticated write API. It must be `https` — the server
rejects `http` outright, because OAuth tokens would otherwise cross the network
in the clear.

The server cannot detect for itself that it is being published: by the time a
request arrives through cloudflared it looks local. So this setting is a
statement of intent, and everything keys off it.

### 3. Create the tunnel

```bash
brew install cloudflared              # or see cloudflare's install docs
cloudflared tunnel login
cloudflared tunnel create cognitive-mirror
cloudflared tunnel route dns cognitive-mirror mcp.example.com
```

Then run it:

```bash
cognitive-mirror tunnel
```

That reads `MCP_PUBLIC_URL`, refuses to run if no passphrase is set, and
forwards `https://mcp.example.com` → `http://127.0.0.1:4003`.

<details>
<summary>Running cloudflared directly instead</summary>

`~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /path/to/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: mcp.example.com
    service: http://127.0.0.1:4003
  - service: http_status:404
```

```bash
cloudflared tunnel run cognitive-mirror
```

</details>

### 4. Add a Cloudflare Access policy

Do this even though OAuth is in place. It is a second lock on the same door, and
it costs one form.

In the Cloudflare dashboard: **Zero Trust → Access → Applications → Add an
application → Self-hosted**, with `mcp.example.com` as the domain.

Then add a policy. Two options, in order of preference:

- **Allow by IP** — restrict to Anthropic's published connector egress ranges,
  so only Anthropic's infrastructure can reach the endpoint at all. Anthropic
  publishes these; check the current list before relying on a copy of it, as
  ranges change and a stale allowlist locks you out rather than failing open.
- **Allow by identity** — require a one-time PIN sent to your own email address.
  Works regardless of where the request comes from, and is the right choice if
  you also want to hit the endpoint from your own browser.

**Bypass the OAuth discovery paths.** Claude's connector fetches these before it
can authenticate, so an Access policy that challenges them breaks the flow before
it starts. Add a *Bypass* policy for:

```
/.well-known/oauth-authorization-server
/.well-known/oauth-protected-resource
```

These serve public metadata only — no tokens, no graph data.

### 5. Connect the client

In claude.ai: **Settings → Connectors → Add custom connector**, and give it
`https://mcp.example.com/mcp`. The client registers itself, sends you to the
consent screen, you enter the passphrase, and it receives a token.

## How the authorisation flow works

```
claude.ai                    your machine
    │
    │  GET /.well-known/oauth-authorization-server
    │─────────────────────────────►  discovery (public)
    │
    │  POST /register                 dynamic client registration
    │─────────────────────────────►  client_id issued
    │
    │  GET /authorize?…               with an S256 PKCE challenge
    │─────────────────────────────►  redirect to the consent page
    │                                 ┌──────────────────────┐
    │  (you type the passphrase)      │  Authorise access    │
    │◄────────────────────────────────│  [passphrase]        │
    │                                 └──────────────────────┘
    │  ?code=…                        single-use, 60s TTL
    │
    │  POST /token  + code_verifier   PKCE verified here
    │─────────────────────────────►  access token (1h) + refresh token (30d)
    │
    │  POST /mcp    Bearer …          every call from here on
    │─────────────────────────────►
```

Registration is deliberately open — that is how Claude clients bootstrap — but
registering gets you nothing without the passphrase.

Notable behaviours:

- **Authorization codes are single-use**, deleted on read rather than after a
  successful exchange, so a replay finds nothing even under a race.
- **Refresh tokens rotate.** Presenting a spent one is treated as theft, not as
  a retry: every token for that client is revoked and you have to authorise
  again.
- **Nothing is stored in the clear.** Codes and tokens are kept as SHA-256
  hashes in `$CM_HOME/.data/oauth.sqlite`, so a copy of that file cannot be
  replayed against the server.
- **The consent POST is rate-limited** to 10 attempts per 15 minutes, because
  guessing the passphrase is the realistic attack.

## Credential rotation and monitoring

**Rotate the passphrase** — after any suspected exposure, and periodically:

```bash
cognitive-mirror auth set-passphrase
cognitive-mirror down && cognitive-mirror up
```

Existing tokens survive a passphrase change; that is the point of refresh
tokens, but it means rotating the passphrase alone does not lock out a client
that already holds one. To cut off every existing client, delete the token
store as well:

```bash
rm ~/.cognitive-mirror/.data/oauth.sqlite
```

Every client then has to authorise again from scratch.

**Rotate the tunnel credentials** if the credentials JSON is ever exposed:

```bash
cloudflared tunnel delete cognitive-mirror
cloudflared tunnel create cognitive-mirror
cloudflared tunnel route dns cognitive-mirror mcp.example.com
```

**Watch the access logs.** Two places are worth checking:

- Cloudflare Zero Trust → Logs → Access, for requests that reached the tunnel.
- Your own server logs: a failed passphrase attempt logs at `warn` with the
  client id. Repeated ones from a client you do not recognise mean someone has
  found your hostname.

If you use ntfy (`NTFY_TOPIC` in `.env`) you already get budget and job alerts
on your phone; the same channel is a reasonable place to route access alerts if
you add them.

## Turning it off

Unset `MCP_PUBLIC_URL` and restart. The server goes back to localhost-only with
no authentication, and stops advertising any discovery metadata. Stop
`cloudflared` too — the tunnel is what makes the hostname resolve at all.
