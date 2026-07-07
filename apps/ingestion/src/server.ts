import { Hono } from "hono";
import { z } from "zod";
import { JOB_TYPE_ENRICH, loadConfig, type EnrichPayload } from "@cm/shared";
import type { JobQueue } from "@cm/queue";
import { contentHash } from "./hash.js";

// Manual POST sources (Apple Shortcuts notes/journal, browser extension, Kindle).
// GitHub/ArXiv/RSS/trending arrive via the daemon, not this webhook.
const IngestBody = z.object({
  kind: z.enum(["note", "journal", "youtube", "kindle_highlight", "github_repo", "generic"]).default("generic"),
  title: z.string(),
  text: z.string(),
  source: z.string().default("webhook"),
  url: z.string().optional(),
  occurredAt: z.string().optional(),
});

/** Bearer or ?token= must match INGEST_TOKEN when one is configured. */
function authorized(c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }): boolean {
  const expected = loadConfig().INGEST_TOKEN;
  if (!expected) return true; // local dev: no token configured
  const auth = c.req.header("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7) : undefined;
  return (bearer ?? c.req.query("token")) === expected;
}

/**
 * Webhook surface for manual ingest sources (design §2). Does no reasoning: it
 * only authenticates, hashes, and enqueues an enrich job.
 */
export function buildIngestServer(queue: JobQueue): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "ingestion" }));
  app.get("/stats", (c) => c.json(queue.stats()));

  app.post("/ingest", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const body = IngestBody.parse(await c.req.json());
    const payload: EnrichPayload = { ...body };
    const r = queue.enqueue({
      type: JOB_TYPE_ENRICH,
      payload,
      contentHash: contentHash(body.kind, body.source, body.text),
    });
    return c.json(r);
  });

  app.onError((err, c) => {
    if (err instanceof z.ZodError) {
      return c.json({ error: "validation", issues: err.issues }, 400);
    }
    return c.json({ error: "internal", message: String(err?.message ?? err) }, 500);
  });

  return app;
}
