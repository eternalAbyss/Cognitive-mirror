import { randomUUID } from "node:crypto";
import type { GraphOp, OpLogEntry } from "@cm/shared";
import { query } from "./falkor.js";

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000; // design §9: 24h undo window for automated destructive ops.

const DESTRUCTIVE: ReadonlySet<GraphOp["kind"]> = new Set(["softDeleteNode", "tombstone"]);

/** Append one operation-log entry per execute() batch and return its id. */
export async function appendOpLog(ops: GraphOp[], reason?: string): Promise<string> {
  const id = randomUUID();
  const ts = new Date().toISOString();
  const hasDestructive = ops.some((o) => DESTRUCTIVE.has(o.kind));
  const undoUntil = hasDestructive
    ? new Date(Date.now() + UNDO_WINDOW_MS).toISOString()
    : undefined;

  await query(
    `CREATE (o:OpLog {id: $id, ts: $ts, reason: $reason, ops: $ops, undoUntil: $undoUntil})`,
    {
      id,
      ts,
      reason: reason ?? "",
      ops: JSON.stringify(ops),
      undoUntil: undoUntil ?? "",
    },
  );
  return id;
}

export async function recentOpLog(limit = 50): Promise<OpLogEntry[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await query<{ props: Record<string, string> }>(
    `MATCH (o:OpLog) RETURN properties(o) AS props ORDER BY o.ts DESC LIMIT ${safeLimit}`,
  );
  return rows.map(({ props }) => ({
    id: props.id ?? "",
    ts: props.ts ?? "",
    reason: props.reason || undefined,
    ops: safeParse(props.ops),
    undoUntil: props.undoUntil || undefined,
  }));
}

export interface UndoResult {
  ok: boolean;
  reason?: string;
  reversed?: number;
}

/**
 * Reverse an automated destructive op batch within its undo window (design §9:
 * the 24h window for ops the engine just did). Un-archives soft-deleted and
 * tombstoned nodes (restoring their original type and dropping the Tombstone
 * label + MERGED_INTO edge). Re-pointed merge edges are not un-pointed —
 * best-effort restoration of the node itself.
 */
export async function undoOpLog(opLogId: string): Promise<UndoResult> {
  const rows = await query<{ props: Record<string, string> }>(
    `MATCH (o:OpLog {id: $id}) RETURN properties(o) AS props`,
    { id: opLogId },
  );
  const props = rows[0]?.props;
  if (!props) return { ok: false, reason: "not_found" };
  if (props.undoUntil && new Date(props.undoUntil).getTime() < Date.now()) {
    return { ok: false, reason: "window_expired" };
  }
  const ops = safeParse(props.ops);
  const ts = new Date().toISOString();
  let reversed = 0;
  for (const op of ops) {
    if (op.kind === "softDeleteNode") {
      await query(`MATCH (n:Node {id: $id}) SET n.archived = false, n.updatedAt = $ts`, {
        id: op.id,
        ts,
      });
      reversed++;
    } else if (op.kind === "tombstone") {
      await query(
        `MATCH (n:Node {id: $id})
         OPTIONAL MATCH (n)-[m:MERGED_INTO]->(:Node)
         DELETE m
         WITH n REMOVE n:Tombstone
         SET n.archived = false, n.type = coalesce(n.prevType, n.type), n.updatedAt = $ts
         REMOVE n.prevType`,
        { id: op.id, ts },
      );
      reversed++;
    }
  }
  return { ok: true, reversed };
}

function safeParse(s: string | undefined): GraphOp[] {
  if (!s) return [];
  try {
    return JSON.parse(s) as GraphOp[];
  } catch {
    return [];
  }
}
