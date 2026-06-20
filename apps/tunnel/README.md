# Tunnel (Cloudflare) — Phase 0 stub

Outbound-only public reachability for the MCP endpoint (design D2 / §4). No inbound
router ports: `cloudflared` makes an outbound connection and publishes a stable URL that
Anthropic's cloud can reach. This is a **stub** — wired up in Phase 0, not Phase 1.

## One-time setup (Phase 0)

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create cognitive-mirror      # prints a TUNNEL_UUID
# Route a hostname you control to the tunnel:
cloudflared tunnel route dns cognitive-mirror mcp.example.com
# Copy config.template.yml -> ~/.cloudflared/config.yml and fill in the UUID + hostname.
cloudflared tunnel run cognitive-mirror
```

The tunnel forwards `https://mcp.example.com` → `http://127.0.0.1:4003` (the MCP server).

## Still required before this is production-safe (Phase 0)

- **OAuth on the MCP server** — only your authenticated Claude account can invoke tools.
  (The Phase-1 server is localhost-only with no auth; do not expose it via the tunnel until
  OAuth is in place.)
- **IP allowlist** to Anthropic's published connector ranges via a Cloudflare Access policy,
  where feasible.
- Rotate tunnel credentials; monitor access logs.

See `config.template.yml`.
