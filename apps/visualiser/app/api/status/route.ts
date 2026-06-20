import { DAEMON, GRAPH_CORE, MCP, getJson } from "../../../lib/services";

export const dynamic = "force-dynamic";

async function up(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { cache: "no-store" })).ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const [graphCore, mcp, daemon, status] = await Promise.all([
    up(`${GRAPH_CORE}/health`),
    up(`${MCP}/health`),
    up(`${DAEMON}/health`),
    getJson<{ budget?: unknown; queue?: unknown }>(`${DAEMON}/status`, {}),
  ]);
  return Response.json({
    services: { graphCore, mcp, daemon },
    budget: status.budget ?? null,
    queue: status.queue ?? null,
  });
}
