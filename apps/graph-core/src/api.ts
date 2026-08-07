import { Hono } from "hono";
import { z } from "zod";
import { ExecuteRequestSchema, GraphOpSchema, NodeTypeSchema } from "@cm/shared";
import { getNode, findByExternalId, searchSemantic, searchChunks, searchText, traverse } from "./repo.js";
import { executeOps } from "./execute.js";
import { recentOpLog, undoOpLog } from "./oplog.js";
import { createApproval, listApprovals, resolveApproval } from "./approvals.js";
import {
  mergeCandidates,
  countsByType,
  listByType,
  crossDomainEdges,
  resurfaceQueue,
  graphSnapshot,
} from "./maintenance.js";

/**
 * Query-string numbers, with junk falling back to the default.
 *
 * `Number("abc")` is NaN, and NaN survives every `Math.max`/`Math.min`/
 * `Math.floor` clamp downstream — so it used to reach Cypher as the literal
 * `LIMIT NaN` and come back as a 500. `?limit=abc` should quietly mean "the
 * default", not "server error".
 */
function intParam(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function floatParam(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const EmbeddingBody = z.object({
  embedding: z.array(z.number()),
  k: z.number().int().positive().optional(),
});

const SemanticBody = EmbeddingBody.extend({ type: NodeTypeSchema.optional() });
const TextBody = z.object({
  query: z.string(),
  k: z.number().int().positive().optional(),
  type: NodeTypeSchema.optional(),
});
const TraverseBody = z.object({
  id: z.string(),
  depth: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
});
const ApprovalSchema = z.object({
  action: z.enum(["merge", "delete"]),
  title: z.string(),
  detail: z.string().default(""),
  ops: z.array(GraphOpSchema).min(1),
  subjectIds: z.array(z.string()).min(1),
});

/** Internal localhost API for the Core Graph Service (design §3). */
export function buildApi(): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "graph-core" }));

  app.get("/node/:id", async (c) => {
    const node = await getNode(c.req.param("id"));
    if (!node) return c.json({ error: "not_found" }, 404);
    return c.json(node);
  });

  app.post("/search/semantic", async (c) => {
    const body = SemanticBody.parse(await c.req.json());
    return c.json({ results: await searchSemantic(body) });
  });

  app.post("/search/text", async (c) => {
    const body = TextBody.parse(await c.req.json());
    return c.json({ results: await searchText(body) });
  });

  app.post("/search/chunks", async (c) => {
    const body = EmbeddingBody.parse(await c.req.json());
    return c.json({ results: await searchChunks(body.embedding, body.k) });
  });

  app.post("/traverse", async (c) => {
    const body = TraverseBody.parse(await c.req.json());
    return c.json({ results: await traverse(body.id, body.depth, body.limit) });
  });

  app.post("/execute", async (c) => {
    const body = ExecuteRequestSchema.parse(await c.req.json());
    return c.json(await executeOps(body.ops, body.reason));
  });

  app.get("/oplog", async (c) => {
    return c.json({ entries: await recentOpLog(intParam(c.req.query("limit"), 50)) });
  });

  // ── Maintenance engine support (design §9) ─────────────────────────────────
  app.get("/maintenance/merge-candidates", async (c) => {
    return c.json({ candidates: await mergeCandidates(floatParam(c.req.query("max"), 0.3)) });
  });

  app.get("/maintenance/cross-domain", async (c) => {
    return c.json({ pairs: await crossDomainEdges() });
  });

  app.get("/maintenance/resurface", async (c) => {
    return c.json({ items: await resurfaceQueue(intParam(c.req.query("limit"), 5)) });
  });

  app.get("/stats/counts", async (c) => c.json({ counts: await countsByType() }));

  app.get("/graph", async (c) => {
    return c.json(await graphSnapshot(intParam(c.req.query("limit"), 1200)));
  });

  app.get("/nodes", async (c) => {
    const type = c.req.query("type") ?? "";
    return c.json({ nodes: await listByType(type, intParam(c.req.query("limit"), 1000)) });
  });

  // Look up a node by its stable external identity (enrichment idempotency).
  app.get("/nodes/by-external-id", async (c) => {
    const externalId = c.req.query("externalId") ?? "";
    return c.json({ node: externalId ? await findByExternalId(externalId) : null });
  });

  // Reverse an automated destructive op within its undo window (design §9).
  app.post("/maintenance/undo", async (c) => {
    const { opLogId } = z.object({ opLogId: z.string() }).parse(await c.req.json());
    return c.json(await undoOpLog(opLogId));
  });

  // ── Human-in-the-loop approvals for edited-note cleanup (design §9) ─────────
  app.get("/approvals", async (c) => c.json({ approvals: await listApprovals() }));

  app.post("/approvals", async (c) => {
    const body = ApprovalSchema.parse(await c.req.json());
    return c.json(await createApproval(body));
  });

  app.post("/approvals/:id/resolve", async (c) => {
    const { decision } = z.object({ decision: z.enum(["approve", "reject"]) }).parse(await c.req.json());
    return c.json(await resolveApproval(c.req.param("id"), decision));
  });

  app.onError((err, c) => {
    if (err instanceof z.ZodError) {
      return c.json({ error: "validation", issues: err.issues }, 400);
    }
    return c.json({ error: "internal", message: String(err?.message ?? err) }, 500);
  });

  return app;
}
