# Connect Cognitive-mirror to Claude Desktop

Claude Desktop runs on the same machine as your graph, so it launches the MCP server
directly over stdio — no tunnel, no OAuth, nothing listening on a port. Tool traffic
never leaves the device. This is the recommended way to use the graph from a Claude
client; the HTTP MCP server and OAuth exist only for reaching it from claude.ai web or
mobile (see [../tunnel/README.md](../tunnel/README.md)).

## Configure

Open **Settings → Developer → Edit Config** in Claude Desktop, which opens
`claude_desktop_config.json`, and add a `cognitive-mirror` entry:

```json
{
  "mcpServers": {
    "cognitive-mirror": {
      "command": "npx",
      "args": ["-y", "cognitive-mirror", "mcp"]
    }
  }
}
```

If you installed the CLI globally (`npm i -g cognitive-mirror`), you can use the binary
directly instead. GUI apps launch with a minimal `PATH`, so give the absolute path that
`which cognitive-mirror` prints:

```json
{
  "mcpServers": {
    "cognitive-mirror": {
      "command": "/absolute/path/to/cognitive-mirror",
      "args": ["mcp"]
    }
  }
}
```

<details>
<summary>Running from a git clone instead of the published package</summary>

Point Desktop at `tsx` and the stdio entrypoint, using absolute paths (again, because of
the minimal `PATH`). Replace `/path/to/Cognitive-mirror` with your checkout, and use the
output of `which node` for the command:

```json
{
  "mcpServers": {
    "cognitive-mirror": {
      "command": "/absolute/path/to/node",
      "args": [
        "/path/to/Cognitive-mirror/node_modules/tsx/dist/cli.mjs",
        "/path/to/Cognitive-mirror/apps/mcp-server/src/stdio.ts"
      ]
    }
  }
}
```

</details>

The server speaks MCP over stdin/stdout; all logging goes to **stderr** so the protocol
stream stays clean (see `packages/shared/src/logger.ts`).

## Use it

1. **Start the backend** — the connector is a thin client and needs it running:

   ```bash
   cognitive-mirror up
   ```

   The connector needs **graph-core (:4001)** for reads and writes, and the
   **reasoning-daemon (:4005)** for `research_topic`.

2. **Fully quit and reopen Claude Desktop** (Cmd-Q / Alt-F4, not just closing the window)
   so it reloads the config.

3. **cognitive-mirror** appears under Settings → Connectors with 12 tools:
   `search_semantic`, `search_text`, `search_chunks`, `get_node`, `traverse_from`,
   `research_topic`, `create_concept`, `relate_nodes`, `create_interest`,
   `get_resurfacing`, `checkpoint_conversation`, `close_conversation`.

4. Try *"research the latest on retrieval-augmented generation"* (writes findings into the
   graph with citations), or *"what does my graph say about X"* (grounded search). To
   auto-capture chats, tell Claude: *"checkpoint this conversation at each sub-topic and
   close it at the end."*

## Troubleshooting

| Symptom | Cause |
|---|---|
| Connector doesn't appear | Config JSON is invalid, or `command` isn't an absolute path. Desktop must be fully quit and reopened. |
| Connector appears but every tool errors | The backend isn't running — `cognitive-mirror up`. |
| `research_topic` errors, others work | The reasoning daemon (:4005) is down, or `ANTHROPIC_API_KEY` isn't set. |

Desktop's own MCP logs are the fastest way in:

- macOS — `~/Library/Logs/Claude/mcp-server-cognitive-mirror.log`
- Windows — `%APPDATA%\Claude\logs\mcp-server-cognitive-mirror.log`
