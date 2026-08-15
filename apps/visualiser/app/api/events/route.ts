import { MCP } from "../../../lib/services";

export const dynamic = "force-dynamic";

/**
 * Proxy the MCP server's live event SSE stream to the browser (same-origin).
 *
 * `req.signal` is forwarded so a closed browser tab actually tears the upstream
 * connection down. Without it every page load stranded a listener on the MCP
 * server, which caps at 100 (`mcp-server/src/events.ts`) — a few refreshes and
 * the stream silently stopped working.
 */
export async function GET(req: Request) {
  try {
    const upstream = await fetch(`${MCP}/events`, {
      headers: { accept: "text/event-stream" },
      signal: req.signal,
    });
    if (!upstream.body) return new Response("event stream unavailable", { status: 502 });
    req.signal.addEventListener("abort", () => {
      void upstream.body?.cancel().catch(() => {});
    });
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
