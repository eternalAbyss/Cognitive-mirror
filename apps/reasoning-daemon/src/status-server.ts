import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { loadConfig, childLogger } from "@cm/shared";
import type { JobQueue } from "@cm/queue";
import type { GraphClient } from "@cm/graph-client";
import { budget } from "./budget.js";
import { researchTopic } from "./research.js";

const log = childLogger("daemon:status");

/**
 * Tiny localhost surface for the daemon: the visualiser's API-cost / health
 * panels (design §15 Phase 4) read budget + queue here, and the MCP server's
 * `research_topic` tool proxies live web research here (so the Anthropic client,
 * budget breaker, and enrichment pipeline stay in the daemon).
 */
export function startStatusServer(queue: JobQueue, graph: GraphClient): () => void {
  const cfg = loadConfig();
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, service: "reasoning-daemon" }));
  app.get("/status", (c) =>
    c.json({ budget: budget.snapshot(), queue: queue.stats() }),
  );
  app.post("/research", async (c) => {
    const { topic } = z.object({ topic: z.string().min(1) }).parse(await c.req.json());
    return c.json(await researchTopic(graph, topic));
  });
  app.onError((err, c) => c.json({ ok: false, error: String(err?.message ?? err) }, 500));
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: cfg.DAEMON_PORT });
  log.info({ port: cfg.DAEMON_PORT }, "status server listening (127.0.0.1)");
  return () => server.close();
}
