import express from "express";
import { loadConfig, childLogger } from "@cm/shared";
import { createGraphClient } from "@cm/graph-client";
import { buildMcpServer, newTransport } from "./server.js";
import { subscribe } from "./events.js";

const log = childLogger("mcp-server");

/**
 * Interactive path (design §3). Exposes MCP tools over Streamable HTTP, bound to
 * 127.0.0.1. The Cloudflare tunnel + OAuth connector (Phase 0) sit in front of
 * this later; for Phase 1 it is verified with a local MCP client.
 */
function main(): void {
  const cfg = loadConfig();
  const graph = createGraphClient();
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "mcp-server" });
  });

  // Live event stream for the future visualiser.
  app.get("/events", (_req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    const unsubscribe = subscribe(res);
    _req.on("close", unsubscribe);
  });

  // MCP endpoint — stateless: a fresh server+transport per request.
  app.post("/mcp", async (req, res) => {
    const server = buildMcpServer(graph);
    const transport = newTransport();
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error({ err: String((err as Error)?.message ?? err) }, "mcp request failed");
      if (!res.headersSent) res.status(500).json({ error: "internal" });
    }
  });

  const methodNotAllowed = (_req: express.Request, res: express.Response) =>
    res.status(405).json({ error: "method_not_allowed" });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  const server = app.listen(cfg.MCP_PORT, "127.0.0.1", () => {
    log.info({ port: cfg.MCP_PORT }, "mcp-server listening (127.0.0.1)");
  });

  const shutdown = () => {
    log.info("shutting down");
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
