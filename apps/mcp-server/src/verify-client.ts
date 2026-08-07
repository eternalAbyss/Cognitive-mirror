import { loadConfig } from "@cm/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Interactive-path smoke test: connects a real MCP client to the running server,
 * lists tools, and exercises a read tool. Run: pnpm --filter @cm/mcp-server verify
 * (graph-core + mcp-server + Ollama must be up; needs no Anthropic key).
 */
const cfg = loadConfig();
const transport = new StreamableHTTPClientTransport(
  new URL(`http://127.0.0.1:${cfg.MCP_PORT}/mcp`),
);
const client = new Client({ name: "verify-client", version: "0.1.0" });
await client.connect(transport);

const tools = await client.listTools();
const search = await client.callTool({
  name: "search_semantic",
  arguments: { query: "which database stores both graph and vectors?", k: 3 },
});

const text =
  Array.isArray(search.content) && search.content[0]?.type === "text" ? search.content[0].text : "";
const hits = (() => {
  try {
    return JSON.parse(text) as unknown[];
  } catch {
    return [];
  }
})();

console.log(
  JSON.stringify(
    {
      toolCount: tools.tools.length,
      toolNames: tools.tools.map((t) => t.name),
      searchHits: hits.length,
      firstHitTitle: (hits[0] as { props?: { title?: string } } | undefined)?.props?.title ?? null,
    },
    null,
    2,
  ),
);
await client.close();
process.exit(0);
