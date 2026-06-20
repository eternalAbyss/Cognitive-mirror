import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NODE_TYPES, EDGE_TYPES, loadConfig, type GraphOp } from "@cm/shared";
import type { GraphClient } from "@cm/graph-client";
import { embed } from "@cm/embeddings";
import { emit } from "./events.js";

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

/**
 * Interactive tools (design §15 Phase 1) — thin wrappers over the Core Graph
 * Service. Reads emit live events; writes go through the same transactional
 * primitive the daemon uses. Conversation tools (§10) are scaffolded here;
 * cooperative-capture logic is Phase 2.
 */
export function registerTools(server: McpServer, graph: GraphClient): void {
  server.registerTool(
    "search_semantic",
    {
      description:
        "Semantic search over knowledge nodes by meaning. Returns the most similar Concepts/Sources.",
      inputSchema: {
        query: z.string().describe("natural-language query"),
        k: z.number().int().positive().max(50).optional(),
        type: z.enum(NODE_TYPES).optional(),
      },
    },
    async ({ query, k, type }) => {
      const embedding = await embed(query);
      const r = await graph.searchSemantic({ embedding, k, type });
      emit("search", { query, hits: r.results.length });
      return json(r.results);
    },
  );

  server.registerTool(
    "search_chunks",
    {
      description:
        "Retrieve the most relevant source content chunks for a query (use to ground an answer).",
      inputSchema: {
        query: z.string(),
        k: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ query, k }) => {
      const embedding = await embed(query);
      const r = await graph.searchChunks(embedding, k);
      emit("search", { query, chunks: r.results.length });
      return json(r.results);
    },
  );

  server.registerTool(
    "get_node",
    {
      description: "Fetch a node by id with its properties and outgoing edges.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const node = await graph.getNode(id);
      emit("node_read", { id });
      return json(node);
    },
  );

  server.registerTool(
    "traverse_from",
    {
      description: "Traverse the graph from a node up to N hops (default 1).",
      inputSchema: {
        id: z.string(),
        depth: z.number().int().positive().max(5).optional(),
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    async ({ id, depth, limit }) => {
      const r = await graph.traverse({ id, depth, limit });
      emit("traverse", { id, depth: depth ?? 1, reached: r.results.length });
      return json(r.results);
    },
  );

  server.registerTool(
    "create_concept",
    {
      description:
        "Guided write: create a Concept node (with a summary embedding) from the current conversation.",
      inputSchema: {
        title: z.string(),
        summary: z.string(),
        domain: z.string().optional(),
      },
    },
    async ({ title, summary, domain }) => {
      const id = randomUUID();
      const ops: GraphOp[] = [
        { kind: "createNode", id, node: { type: "Concept", title, summary, domain } },
        { kind: "setSummaryEmbedding", id, embedding: await embed(summary || title) },
      ];
      const res = await graph.execute(ops, `create_concept: ${title}`);
      emit("write", { op: "create_concept", id });
      return json({ id, opLogId: res.opLogId });
    },
  );

  server.registerTool(
    "relate_nodes",
    {
      description: "Guided write: create a typed edge between two existing nodes.",
      inputSchema: {
        from: z.string(),
        to: z.string(),
        type: z.enum(EDGE_TYPES),
      },
    },
    async ({ from, to, type }) => {
      const res = await graph.execute(
        [{ kind: "createEdge", from, to, type }],
        `relate_nodes: ${from} -${type}-> ${to}`,
      );
      emit("write", { op: "relate_nodes", from, to, type });
      return json({ opLogId: res.opLogId });
    },
  );

  server.registerTool(
    "research_topic",
    {
      description:
        "Search the LIVE web for a topic and write the findings into the knowledge graph as notes (a Source node + extracted Concepts, with citations). Use when the user asks to research, look up, or learn about something that isn't already in the graph. Returns the briefing and how many notes were added.",
      inputSchema: { topic: z.string().describe("the topic or question to research on the web") },
    },
    async ({ topic }) => {
      const cfg = loadConfig();
      let res: Response;
      try {
        res = await fetch(`http://127.0.0.1:${cfg.DAEMON_PORT}/research`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic }),
        });
      } catch {
        return json({ ok: false, error: "reasoning daemon unreachable — is it running?" });
      }
      if (!res.ok) return json({ ok: false, error: `research failed (${res.status})` });
      const data = await res.json();
      emit("write", { op: "research_topic", topic });
      return json(data);
    },
  );

  server.registerTool(
    "get_resurfacing",
    {
      description:
        "At session start, fetch 1–2 open conversation loops worth resurfacing (ranked by recency × activity, design §9). Offer the user to continue / park / close them.",
      inputSchema: { limit: z.number().int().positive().max(5).optional() },
    },
    async ({ limit }) => {
      const r = await graph.resurface(limit ?? 2);
      emit("node_read", { op: "get_resurfacing", count: r.items.length });
      return json(r.items);
    },
  );

  server.registerTool(
    "create_interest",
    {
      description:
        "Bootstrap a net-new Interest domain (design §13 Q4) so future world-brief signal can be scored against it.",
      inputSchema: { title: z.string(), summary: z.string() },
    },
    async ({ title, summary }) => {
      const id = randomUUID();
      const ops: GraphOp[] = [
        { kind: "createNode", id, node: { type: "Interest", title, summary } },
        { kind: "setSummaryEmbedding", id, embedding: await embed(summary || title) },
      ];
      const res = await graph.execute(ops, `create_interest: ${title}`);
      emit("write", { op: "create_interest", id });
      return json({ id, opLogId: res.opLogId });
    },
  );

  // ── Cooperative conversation capture (design §10) ──────────────────────────
  server.registerTool(
    "checkpoint_conversation",
    {
      description:
        "Call at each semantic breakpoint (a sub-topic closes). Omit conversationId to OPEN a conversation; pass it back to APPEND. Deltas accumulate, so an abrupt ending loses at most the last segment. Returns the conversationId — reuse it for the whole session.",
      inputSchema: {
        conversationId: z.string().optional(),
        delta: z.string().describe("what was discussed/decided since the last checkpoint"),
        openQuestions: z.array(z.string()).optional(),
        conclusions: z.array(z.string()).optional(),
      },
    },
    async ({ conversationId, delta, openQuestions, conclusions }) => {
      if (!conversationId) {
        const id = randomUUID();
        const meta = {
          status: "open",
          checkpoints: 1,
          openQuestions: openQuestions ?? [],
          conclusions: conclusions ?? [],
        };
        await graph.execute(
          [{ kind: "createNode", id, node: { type: "Conversation", title: delta.slice(0, 80), summary: delta, metadata: meta } }],
          "checkpoint_conversation: open",
        );
        emit("write", { op: "checkpoint_conversation", id, opened: true });
        return json({ conversationId: id });
      }
      // Append: read current node, concatenate the delta, merge questions/conclusions.
      const node = await graph.getNode(conversationId).catch(() => null);
      const prevSummary = String(node?.props?.summary ?? "");
      const prevMeta = parseMeta(node?.props?.metadata);
      const meta = {
        status: "open",
        checkpoints: (Number(prevMeta.checkpoints) || 0) + 1,
        openQuestions: mergeUnique(prevMeta.openQuestions, openQuestions),
        conclusions: mergeUnique(prevMeta.conclusions, conclusions),
      };
      await graph.execute(
        [{ kind: "updateNode", id: conversationId, patch: { summary: `${prevSummary}\n\n— ${delta}`, metadata: meta } }],
        "checkpoint_conversation: append",
      );
      emit("write", { op: "checkpoint_conversation", id: conversationId, checkpoints: meta.checkpoints });
      return json({ conversationId, checkpoints: meta.checkpoints });
    },
  );

  server.registerTool(
    "close_conversation",
    {
      description: "Finalise a conversation at session end. Computes a summary embedding so the conversation becomes a merge/brief candidate.",
      inputSchema: {
        conversationId: z.string(),
        status: z.enum(["closed", "parked"]).default("closed"),
      },
    },
    async ({ conversationId, status }) => {
      const node = await graph.getNode(conversationId).catch(() => null);
      const summary = String(node?.props?.summary ?? "");
      const prevMeta = parseMeta(node?.props?.metadata);
      const ops: GraphOp[] = [
        { kind: "updateNode", id: conversationId, patch: { metadata: { ...prevMeta, status } } },
      ];
      if (summary) ops.push({ kind: "setSummaryEmbedding", id: conversationId, embedding: await embed(summary) });
      await graph.execute(ops, `close_conversation: ${status}`);
      emit("write", { op: "close_conversation", id: conversationId, status });
      return json({ conversationId, status });
    },
  );
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return (raw as Record<string, unknown>) ?? {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mergeUnique(prev: unknown, next: string[] | undefined): string[] {
  const a = Array.isArray(prev) ? (prev as string[]) : [];
  return Array.from(new Set([...a, ...(next ?? [])]));
}
