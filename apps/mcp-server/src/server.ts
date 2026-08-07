import type { GraphClient } from "@cm/graph-client";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools.js";

/**
 * Build a fresh MCP server instance with all tools registered. In stateless mode
 * we create one per request (see index.ts), which is the simplest correct
 * Streamable-HTTP pattern for a low-traffic local connector.
 */
const STANDING_INSTRUCTIONS = `This connector is the user's second brain — a knowledge graph.
Cooperative conversation capture (design §10): when a conversation touches durable ideas, call
\`checkpoint_conversation\` at each semantic breakpoint (when a sub-topic closes), passing a short
\`delta\` plus any \`openQuestions\`/\`conclusions\`. Omit \`conversationId\` on the first call to open the
conversation, then reuse the returned id for the rest of the session. Call \`close_conversation\` at
the end. Use \`search_semantic\`/\`search_chunks\`/\`get_node\`/\`traverse_from\` to ground answers in the
graph before responding, and cite node titles.`;

export function buildMcpServer(graph: GraphClient): McpServer {
  const server = new McpServer(
    { name: "cognitive-mirror", version: "0.1.0" },
    { instructions: STANDING_INSTRUCTIONS },
  );
  registerTools(server, graph);
  return server;
}

/** Stateless Streamable-HTTP transport (no session persistence). */
export function newTransport(): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
}
