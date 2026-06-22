import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Launches the server with the EXACT command Claude Desktop uses (absolute node
 * + tsx + stdio.ts, from a neutral cwd) and lists its tools — proving the
 * Desktop connector will work. Run: pnpm --filter @cm/mcp-server exec tsx src/verify-stdio.ts
 */
const REPO = "/Users/eternalabyss/Code/Cognitive-mirror";
const transport = new StdioClientTransport({
  command: "/opt/homebrew/bin/node",
  args: [`${REPO}/node_modules/tsx/dist/cli.mjs`, `${REPO}/apps/mcp-server/src/stdio.ts`],
  cwd: "/",
});
const client = new Client({ name: "verify-stdio", version: "0.1.0" });
await client.connect(transport);
const tools = await client.listTools();
console.log(JSON.stringify({ ok: true, count: tools.tools.length, tools: tools.tools.map((t) => t.name) }, null, 2));
await client.close();
process.exit(0);
