import { randomUUID } from "node:crypto";
import {
  EDGE_TYPES,
  NODE_TYPES,
  type ExecuteResult,
  type GraphOp,
  type SubOpResult,
} from "@cm/shared";
import { query, vecLiteral } from "./falkor.js";
import { appendOpLog } from "./oplog.js";

/**
 * The transactional mutation primitive (design §13 Q1). All writes — interactive
 * (via MCP) and autonomous (via the daemon) — funnel through here so there is a
 * single writer and one op-log entry per batch.
 *
 * NOTE: ops are currently applied sequentially rather than in a single FalkorDB
 * transaction. Cross-op atomicity (MULTI/EXEC) is deferred to Phase 3 hardening;
 * for Phase 1 each sub-op records its own success/error and the batch is logged.
 */
export async function executeOps(
  ops: GraphOp[],
  reason?: string,
): Promise<ExecuteResult> {
  const results: SubOpResult[] = [];
  for (const op of ops) {
    try {
      results.push(await applyOne(op));
    } catch (err) {
      results.push({
        kind: op.kind,
        ids: [],
        error: String((err as Error)?.message ?? err),
      });
    }
  }
  const opLogId = await appendOpLog(ops, reason);
  return { opLogId, results };
}

function assertNodeType(t: string): string {
  if (!(NODE_TYPES as readonly string[]).includes(t)) {
    throw new Error(`invalid node type: ${t}`);
  }
  return t;
}

function assertEdgeType(t: string): string {
  if (!(EDGE_TYPES as readonly string[]).includes(t)) {
    throw new Error(`invalid edge type: ${t}`);
  }
  return t;
}

/** FalkorDB stores scalars/arrays as properties; nested objects are JSON-stringified. */
function flatten(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] =
      v !== null && typeof v === "object" && !Array.isArray(v)
        ? JSON.stringify(v)
        : v;
  }
  return out;
}

async function applyOne(op: GraphOp): Promise<SubOpResult> {
  const ts = new Date().toISOString();

  switch (op.kind) {
    case "createNode": {
      const type = assertNodeType(op.node.type);
      const id = op.id ?? op.node.id ?? randomUUID();
      const props = flatten({
        ...op.node,
        id,
        type,
        summary: op.node.summary ?? "",
        archived: false,
        createdAt: ts,
        updatedAt: ts,
      });
      await query(`CREATE (n:Node:${type}) SET n += $props`, { props });
      return { kind: op.kind, ids: [id] };
    }

    case "updateNode": {
      await query(
        `MATCH (n:Node {id: $id}) SET n += $patch, n.updatedAt = $ts`,
        { id: op.id, patch: flatten(op.patch), ts },
      );
      return { kind: op.kind, ids: [op.id] };
    }

    case "softDeleteNode": {
      await query(
        `MATCH (n:Node {id: $id}) SET n.archived = true, n.updatedAt = $ts`,
        { id: op.id, ts },
      );
      return { kind: op.kind, ids: [op.id] };
    }

    case "createEdge": {
      const type = assertEdgeType(op.type);
      await query(
        `MATCH (a:Node {id: $from}), (b:Node {id: $to})
         CREATE (a)-[r:${type}]->(b) SET r += $props, r.createdAt = $ts`,
        { from: op.from, to: op.to, props: flatten(op.props ?? {}), ts },
      );
      return { kind: op.kind, ids: [op.from, op.to] };
    }

    case "tombstone": {
      // Re-point the loser's relationships onto the survivor so it inherits the
      // merged node's connections (design §9). Done per known edge type since
      // Cypher can't bind a dynamic relationship type.
      const REPOINT = ["RELATES_TO", "MENTIONS", "CONTRADICTS", "DERIVED_FROM"] as const;
      for (const t of REPOINT) {
        await query(
          `MATCH (l:Node {id: $id})-[:${t}]->(x:Node) WHERE x.id <> $survivor
           MATCH (s:Node {id: $survivor}) MERGE (s)-[:${t}]->(x)`,
          { id: op.id, survivor: op.survivorId },
        );
        await query(
          `MATCH (x:Node)-[:${t}]->(l:Node {id: $id}) WHERE x.id <> $survivor
           MATCH (s:Node {id: $survivor}) MERGE (x)-[:${t}]->(s)`,
          { id: op.id, survivor: op.survivorId },
        );
      }
      // Tombstone the loser (preserve prevType for undo) and cool down the survivor.
      const cooldownUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await query(
        `MATCH (n:Node {id: $id})
         SET n.prevType = coalesce(n.prevType, n.type), n:Tombstone,
             n.archived = true, n.type = 'Tombstone', n.updatedAt = $ts
         WITH n MATCH (s:Node {id: $survivor})
         SET s.mergeCooldownUntil = $cooldownUntil
         CREATE (n)-[:MERGED_INTO {createdAt: $ts}]->(s)`,
        { id: op.id, survivor: op.survivorId, ts, cooldownUntil },
      );
      return { kind: op.kind, ids: [op.id, op.survivorId] };
    }

    case "upsertChunk": {
      const { chunk } = op;
      await query(
        `MERGE (c:Chunk {id: $id})
         SET c.text = $text, c.ordinal = $ord, c.sourceNodeId = $src,
             c.embedding = ${vecLiteral(chunk.embedding)}, c.updatedAt = $ts
         WITH c MATCH (s:Node {id: $src})
         MERGE (s)-[:HAS_CHUNK]->(c)`,
        {
          id: chunk.id,
          text: chunk.text,
          ord: chunk.ordinal,
          src: chunk.sourceNodeId,
          ts,
        },
      );
      return { kind: op.kind, ids: [chunk.id] };
    }

    case "setSummaryEmbedding": {
      await query(
        `MATCH (n:Node {id: $id}) SET n.summary_embedding = ${vecLiteral(
          op.embedding,
        )}, n.updatedAt = $ts`,
        { id: op.id, ts },
      );
      return { kind: op.kind, ids: [op.id] };
    }
  }
}
