import { MCP } from "../../../lib/services";

export const dynamic = "force-dynamic";

/** Proxy the MCP server's live event SSE stream to the browser (same-origin). */
export async function GET() {
  try {
    const upstream = await fetch(`${MCP}/events`, {
      headers: { accept: "text/event-stream" },
    });
    if (!upstream.body) return new Response("event stream unavailable", { status: 502 });
    return new Response(upstream.body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch {
    return new Response("mcp unreachable", { status: 502 });
  }
}
