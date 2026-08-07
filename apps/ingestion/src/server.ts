import { timingSafeEqual } from "node:crypto";
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

/** Length-independent constant-time compare, so a bad token leaks no timing. */
function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal — compare equal-length buffers and fold length into the result.
  if (ab.length !== bb.length) return timingSafeEqual(ab, ab) && false;
  return timingSafeEqual(ab, bb);
}

/**
 * A Bearer token must match INGEST_TOKEN.
 *
 * This fails **closed**: with no INGEST_TOKEN set, /ingest is rejected rather
 * than opened. It used to be the other way round, which meant the default
 * configuration shipped an unauthenticated write endpoint. Set
 * ALLOW_ANONYMOUS_INGEST=true to opt back into the open behaviour for local
 * development — an explicit choice, logged at startup.
 *
 * The token is only read from the Authorization header. The old `?token=`
 * fallback put a secret in query strings, where it lands in access logs,
 * browser history, and Referer headers.
 */
function authorized(c: { req: { header: (n: string) => string | undefined } }): boolean {
  const cfg = loadConfig();
  if (!cfg.INGEST_TOKEN) return cfg.ALLOW_ANONYMOUS_INGEST;
  const auth = c.req.header("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return false;
  return secretEquals(auth.slice(7), cfg.INGEST_TOKEN);
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
