import { createGraphClient } from "@cm/graph-client";
import { childLogger, loadConfig } from "@cm/shared";
import express from "express";
import { setupAuth } from "./auth/index.js";
import { subscribe } from "./events.js";
import { buildMcpServer, newTransport } from "./server.js";

const log = childLogger("mcp-server");

/**
 * Interactive path (design §3). Exposes MCP tools over Streamable HTTP, bound to
 * 127.0.0.1.
 *
 * Two modes, chosen by whether `MCP_PUBLIC_URL` is set:
 *
 *  - **unset** — localhost only, no authentication. Nothing can reach it but
 *    processes on this machine, and Claude Desktop uses the stdio server
 *    (`src/stdio.ts`) rather than this one.
 *  - **set** — you intend to publish it through a tunnel, so OAuth 2.1 is
 *    enforced on `/mcp` and `/events`, and the process refuses to start without
 *    a passphrase. See `apps/tunnel/README.md`.
 */
function main(): void {
  const cfg = loadConfig();
  const graph = createGraphClient();
  const app = express();

  // Behind cloudflared, so trust exactly one proxy hop — the rate limiter reads
  // the client IP from X-Forwarded-For, and trusting every hop would let a
  // caller spoof it and slip the login limit.
  app.set("trust proxy", 1);

  const auth = setupAuth();
  // Must be mounted at the app root: the discovery documents live at fixed
  // /.well-known paths that clients fetch before anything else.
  if (auth) app.use(auth.router);

  app.use(express.json({ limit: "4mb" }));

  // Unauthenticated on purpose: a liveness probe reveals nothing, and `up` and
  // `status` both need it before any token exists.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "mcp-server", auth: auth ? "oauth" : "none" });
  });

  const protect = auth ? [auth.guard] : [];

  // Live event stream for the visualiser.
  app.get("/events", ...protect, (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    const unsubscribe = subscribe(res);
    req.on("close", unsubscribe);
  });

  // MCP endpoint — stateless: a fresh server+transport per request.
  app.post("/mcp", ...protect, (req, res) => {
    void (async () => {
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
    })();
  });

  const methodNotAllowed = (_req: express.Request, res: express.Response) =>
    res.status(405).json({ error: "method_not_allowed" });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  const server = app.listen(cfg.MCP_PORT, "127.0.0.1", () => {
    log.info(
      { port: cfg.MCP_PORT, auth: auth ? "oauth" : "none" },
      "mcp-server listening (127.0.0.1)",
    );
  });

  const shutdown = () => {
    log.info("shutting down");
    auth?.store.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
