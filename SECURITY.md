# Security

## Reporting a vulnerability

Please report privately via [GitHub Security
Advisories](https://github.com/eternalAbyss/Cognitive-mirror/security/advisories/new)
rather than opening a public issue. I'll acknowledge within a few days.

This is a personal project maintained by one person, not a funded product. There
is no bounty, and no formal SLA — but I take reports seriously and will credit
you unless you'd rather I didn't.

## The trust model

Cognitive-mirror stores the contents of your journal, your notes, your reading,
and your commits, and lets a language model write to that store on its own
schedule. It's worth being precise about what that does and doesn't protect.

### What is enforced

**Everything binds to loopback.** All five services and both containers listen on
`127.0.0.1` only. Nothing is reachable from your network unless you deliberately
publish it (see below). This includes the visualiser, which proxies
unauthenticated writes to the backend and would be the worst thing to expose.

**The ingest webhook fails closed.** `/ingest` returns 401 with no
`INGEST_TOKEN` set. `ALLOW_ANONYMOUS_INGEST=true` opts out, explicitly, for local
experimentation. The token is compared in constant time and read only from the
`Authorization` header — never a query string, which would put it in logs.

**Off-device access requires OAuth 2.1.** Setting `MCP_PUBLIC_URL` turns on the
authorization server *and makes it mandatory*: the MCP server refuses to start
without a passphrase hash, and refuses a non-`https` URL. S256 PKCE is enforced,
authorization codes are single-use, refresh tokens rotate, and codes and tokens
are stored only as SHA-256 hashes. See
[apps/tunnel/README.md](apps/tunnel/README.md).

**Writes go through one door.** Every mutation — from the daemon, from MCP, from
the UI — funnels through the graph service's `execute` batch, which is
schema-validated, applied with compensating inverses so a partial batch rolls
back, and written to an op log with a 24-hour undo window. Deletes are soft.

**Spend is capped.** The budget breaker persists across restarts and stops
non-essential API calls at a daily and monthly limit. It counts against a
built-in price table, so it works out of the box rather than only after you
configure prices.

### What is not

**A language model writes to your graph without asking.** Enrichment turns
third-party text — GitHub READMEs, RSS bodies, scraped video descriptions, live
web-search results — into concepts and edges, and those writes are not gated on
your approval. The realistic risk is **graph poisoning**: text crafted to steer
what gets recorded as fact. Untrusted content is fenced in the prompt and the
model is told to treat it as data, which raises the bar but does not eliminate
it.

There is no exfiltration path from these prompts — the model has no network tool
reachable from enrichment — and every write is in the op log with a 24-hour undo
window. But if you point `research_topic` at a hostile page, you should expect
the graph to contain what that page said.

**Nightly maintenance can merge and archive without asking.** The approval queue
intercepts only actions affecting notes you hand-edited. A purely
model-generated concept can be merged away on the model's own judgement. This is
deliberate — the graph is meant to be self-managing — but it means the model's
mistakes are your mistakes until you notice them in the op log.

**Local processes are trusted.** Anything running as your user can reach the
loopback services and read the graph. There is no per-process authorisation.

**Secrets live in a file.** `.env` is `0600` and gitignored, and on macOS the
Anthropic key and GitHub token can live in the Keychain instead. Everything else
is plaintext on disk. Full-disk encryption is the answer here, not this project.

**The graph itself is unencrypted.** FalkorDB's data is a Docker volume in the
clear.

### If you publish the MCP endpoint

Do all three, not just the first:

1. OAuth (automatic once `MCP_PUBLIC_URL` is set — with a long passphrase).
2. A Cloudflare tunnel, so no router port opens and your home IP stays private.
3. A **Cloudflare Access policy** in front of it, so a bug in (1) isn't the only
   thing between the internet and your journal.

Rotation and monitoring: [apps/tunnel/README.md](apps/tunnel/README.md).

## Supported versions

Latest release only. This is a young project; please upgrade before reporting.

## Known accepted risks

These are deliberate, documented decisions rather than oversights. Tell me if
you think one is wrong:

| Decision | Reasoning |
|---|---|
| Dynamic client registration is open | Claude clients bootstrap via DCR. Registering grants nothing without the passphrase. |
| One passphrase, one scope | Single-user by design. Every tool reads the same graph, so splitting scopes would imply a separation that doesn't exist. |
| A replayed refresh token revokes all of that client's tokens | Replay means a bug or a theft; assuming theft is the safe reading. |
| The visualiser has no auth | It is loopback-only and is the front end for your own machine. Do not expose it. |
| `/health` is unauthenticated | It reveals only liveness, and the CLI needs it before any token exists. |
