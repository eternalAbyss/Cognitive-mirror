import { randomUUID } from "node:crypto";
import {
  EDGE_TYPES,
  NODE_TYPES,
  childLogger,
  type ExecuteResult,
  type GraphOp,
  type SubOpResult,
} from "@cm/shared";
import { query, vecLiteral } from "./falkor.js";
import { appendOpLog } from "./oplog.js";

const log = childLogger("graph-core:execute");

/** Undoes one already-applied sub-op; run in reverse order when a batch aborts. */
type Compensation = () => Promise<void>;

/**
 * The transactional mutation primitive (design §13 Q1). All writes — interactive
 * (via MCP) and autonomous (via the daemon) — funnel through here so there is a
 * single writer and one op-log entry per batch.
 *
 * Cross-op atomicity: FalkorDB only guarantees atomicity *within* a single Cypher
 * query (and tombstone is inherently multi-statement), so a batch can't be one
 * transaction. Instead each sub-op is applied with a compensating inverse; if any
 * sub-op throws, the inverses already collected are run in reverse to undo the
 * partial batch, and the error is rethrown so callers fail fast rather than commit
 * half a batch. The batch is all-or-nothing as observed by callers. (Re-pointed
 * merge edges from a tombstone are the one best-effort case — see compensateTombstone.)
 */
export async function executeOps(
  ops: GraphOp[],
  reason?: string,
): Promise<ExecuteResult> {
  const results: SubOpResult[] = [];
  const compensations: Compensation[] = [];

  for (const op of ops) {
    try {
      const { result, compensate } = await applyWithCompensation(op);
      results.push(result);
      compensations.push(compensate);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      log.warn({ op: op.kind, err: msg, applied: compensations.length }, "sub-op failed; rolling back batch");
      await rollback(compensations);
      throw new Error(`execute batch aborted at ${op.kind}: ${msg}`);
    }
  }

  const opLogId = await appendOpLog(ops, reason);
  return { opLogId, results };
}

/** Run compensations newest-first; never throw (we're already unwinding). */
async function rollback(compensations: Compensation[]): Promise<void> {
  for (const undo of [...compensations].reverse()) {
    try {
      await undo();
    } catch (err) {
      log.error({ err: String((err as Error)?.message ?? err) }, "compensation failed during rollback");
    }
  }
}

/** Read a node's stored properties for pre-image capture (null if it doesn't exist). */
async function readProps(id: string): Promise<Record<string, unknown> | null> {
  const rows = await query<{ props: Record<string, unknown> }>(
    `MATCH (n:Node {id: $id}) RETURN properties(n) AS props`,
    { id },
  );
  return rows[0]?.props ?? null;
}

/**
 * Apply one op and return its result plus a closure that reverses it. Pre-images
 * (for updates/deletes/embeddings) are captured *before* the mutation so the
 * inverse can restore prior values.
 */
async function applyWithCompensation(
  op: GraphOp,
): Promise<{ result: SubOpResult; compensate: Compensation }> {
  switch (op.kind) {
    case "createNode": {
      const result = await applyOne(op);
      const id = result.ids[0]!;
      return { result, compensate: async () => void (await query(`MATCH (n:Node {id: $id}) DETACH DELETE n`, { id })) };
    }

    case "updateNode": {
      const before = await readProps(op.id);
      const keys = Object.keys(op.patch).filter((k) => op.patch[k] !== undefined && k !== "summary_embedding");
      keys.push("updatedAt"); // applyOne stamps this
      const restore: Record<string, unknown> = {};
      const removeKeys: string[] = [];
      for (const k of keys) {
        if (before && k in before) restore[k] = before[k];
        else removeKeys.push(k);
      }
      const result = await applyOne(op);
      return {
        result,
        compensate: async () => {
          if (!before) return; // node didn't exist; SET was a no-op
          if (Object.keys(restore).length) await query(`MATCH (n:Node {id: $id}) SET n += $restore`, { id: op.id, restore });
          if (removeKeys.length) await query(`MATCH (n:Node {id: $id}) REMOVE ${removeKeys.map((k) => `n.\`${k}\``).join(", ")}`, { id: op.id });
        },
      };
    }

    case "softDeleteNode": {
      const before = await readProps(op.id);
      const result = await applyOne(op);
      return {
        result,
        compensate: async () => {
          if (!before) return;
          await query(`MATCH (n:Node {id: $id}) SET n.archived = $archived, n.updatedAt = $ts`, {
            id: op.id,
            archived: before.archived ?? false,
            ts: before.updatedAt ?? new Date().toISOString(),
          });
        },
      };
    }

    case "createEdge": {
      const type = assertEdgeType(op.type);
      const result = await applyOne(op);
      // Delete exactly one matching edge (applyOne CREATEs one, so this restores the count).
      return {
        result,
        compensate: async () =>
          void (await query(
            `MATCH (a:Node {id: $from})-[r:${type}]->(b:Node {id: $to}) WITH r LIMIT 1 DELETE r`,
            { from: op.from, to: op.to },
          )),
      };
    }

    case "tombstone": {
      const result = await applyOne(op);
      return { result, compensate: () => compensateTombstone(op.id) };
    }

    case "upsertChunk": {
      const existing = await query<{ id: string }>(`MATCH (c:Chunk {id: $id}) RETURN c.id AS id`, { id: op.chunk.id });
      const existedBefore = existing.length > 0;
      const result = await applyOne(op);
      return {
        result,
        compensate: async () => {
          // Chunks are derived/regenerable; if it's new, drop it — if it pre-existed,
          // leave the (re-embedded) chunk in place rather than restore a stale vector.
          if (!existedBefore) await query(`MATCH (c:Chunk {id: $id}) DETACH DELETE c`, { id: op.chunk.id });
        },
      };
    }

    case "setSummaryEmbedding": {
      const before = await readProps(op.id);
      const prev = Array.isArray(before?.summary_embedding) ? (before!.summary_embedding as number[]) : null;
      const prevTs = (before?.updatedAt as string) ?? new Date().toISOString();
      const result = await applyOne(op);
      return {
        result,
        compensate: async () => {
          if (!before) return;
          if (prev) {
            await query(`MATCH (n:Node {id: $id}) SET n.summary_embedding = ${vecLiteral(prev)}, n.updatedAt = $ts`, { id: op.id, ts: prevTs });
          } else {
            await query(`MATCH (n:Node {id: $id}) REMOVE n.summary_embedding SET n.updatedAt = $ts`, { id: op.id, ts: prevTs });
          }
        },
      };
    }
  }
}

/**
 * Reverse a tombstone (design §9): drop the Tombstone label + MERGED_INTO edge,
 * restore the original type, un-archive, and clear the survivor's merge cooldown.
 * Edges re-pointed onto the survivor are NOT un-pointed — best-effort, matching
 * the 24h-window undo in oplog.ts.
 */
async function compensateTombstone(id: string): Promise<void> {
  const ts = new Date().toISOString();
  await query(
    `MATCH (n:Node {id: $id})
     OPTIONAL MATCH (n)-[m:MERGED_INTO]->(s:Node)
     SET s.mergeCooldownUntil = null
     DELETE m
     WITH n REMOVE n:Tombstone
     SET n.archived = false, n.type = coalesce(n.prevType, n.type), n.updatedAt = $ts
     REMOVE n.prevType`,
    { id, ts },
  );
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
