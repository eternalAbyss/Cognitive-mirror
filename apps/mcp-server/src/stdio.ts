import { createGraphClient } from "@cm/graph-client";
import { childLogger } from "@cm/shared";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "./server.js";

/**
 * stdio entrypoint for the Claude Desktop local connector. Desktop launches this
 * as a subprocess and speaks MCP over stdin/stdout, so NOTHING may write to
 * stdout except protocol frames (the shared logger writes to stderr).
 *
 * Requires the backend stack running: graph-core (:4001) for reads/writes and
 * the reasoning-daemon (:4005) for the `research_topic` tool.
 */
const log = childLogger("mcp-server:stdio");

const graph = createGraphClient();
const server = buildMcpServer(graph);
const transport = new StdioServerTransport();
await server.connect(transport);
log.info("cognitive-mirror MCP server connected over stdio");
