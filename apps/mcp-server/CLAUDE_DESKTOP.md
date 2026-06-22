# Connect to Claude Desktop (local stdio connector)

The Desktop app runs on the same machine, so it can launch the MCP server directly over
stdio — no Cloudflare tunnel or OAuth needed (that's only for claude.ai web / mobile, Phase 0).
This is the "Mac-Mini-only, maximum-privacy" mode from the design (§2): tool traffic stays on-device.

## What was configured

An entry was added to `~/Library/Application Support/Claude/claude_desktop_config.json`
(original backed up to `…/claude_desktop_config.json.bak`):

```json
{
  "mcpServers": {
    "cognitive-mirror": {
      "command": "/opt/homebrew/bin/node",
      "args": [
        "/Users/eternalabyss/Code/Cognitive-mirror/node_modules/tsx/dist/cli.mjs",
        "/Users/eternalabyss/Code/Cognitive-mirror/apps/mcp-server/src/stdio.ts"
      ]
    }
  }
}
```

Absolute paths are used because GUI apps launch with a minimal `PATH`. The server
(`src/stdio.ts`) speaks MCP over stdin/stdout; all logging goes to **stderr** so the
protocol stream stays clean (see `packages/shared/src/logger.ts`).

## To use it

1. **Start the backend** (the connector talks to it):
   ```bash
   pnpm db:up      # FalkorDB + Ollama (Docker)
   pnpm dev        # graph-core :4001, reasoning-daemon :4005, ingestion, mcp(http)
   ```
   The Desktop connector needs **graph-core (:4001)** for reads/writes and the
   **reasoning-daemon (:4005)** for `research_topic`. (`pnpm dev` also runs the HTTP MCP on
   :4003 — harmless; Desktop uses its own stdio subprocess.)
2. **Fully quit and reopen Claude Desktop** (Cmd-Q, not just close) so it reloads the config.
3. The **cognitive-mirror** connector appears in Settings → Connectors with 11 tools:
   `search_semantic`, `search_chunks`, `get_node`, `traverse_from`, `research_topic`,
   `create_concept`, `relate_nodes`, `create_interest`, `get_resurfacing`,
   `checkpoint_conversation`, `close_conversation`.
4. Ask things like *"research the latest on retrieval-augmented generation"* (writes notes),
   or *"what does my graph say about X"* (grounded search). To auto-capture chats, tell Claude:
   *"checkpoint this conversation at each sub-topic and close it at the end."*

## Verify / troubleshoot

- Smoke-test the exact launch command without Desktop:
  ```bash
  pnpm --filter @cm/mcp-server exec tsx src/verify-stdio.ts
  ```
  Expect `{ ok: true, count: 11, tools: [...] }`.
- Desktop MCP logs: `~/Library/Logs/Claude/mcp-server-cognitive-mirror.log` (and `mcp.log`).
- If tools error: the backend isn't running — start `pnpm dev`.
- If the connector doesn't appear: confirm `node` path (`which node`) matches the config; fully
  quit Desktop and reopen.
