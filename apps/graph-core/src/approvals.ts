import { randomUUID } from "node:crypto";
import type { GraphOp } from "@cm/shared";
import { query } from "./falkor.js";
import { executeOps } from "./execute.js";

/**
 * Human-in-the-loop approvals for the autonomous cleanup (design §9). When the
 * maintenance engine wants to merge or delete a node the user has *edited*, it
 * does not act — it records a proposal here for the user to allow/reject from the
 * visualiser. Stored as `:Approval` nodes (NOT `:Node`, so they never appear in
 * search or the graph snapshot — the same trick `:OpLog` uses).
 *
 * The proposed `ops` are fully formed and serialized at proposal time (including
 * any LLM-merged summary + embedding), so approving needs no further reasoning —
 * it just replays them through the single-writer execute primitive.
 */
const REJECT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // don't re-propose a rejected action for 24h

export type ApprovalAction = "merge" | "delete";

export interface ApprovalInput {
  action: ApprovalAction;
  title: string;
  detail: string;
  ops: GraphOp[];
  subjectIds: string[];
}

export interface Approval {
  id: string;
  ts: string;
  action: ApprovalAction;
  title: string;
  detail: string;
  subjectIds: string[];
}

/** Create a pending approval, deduped: if an identical pending proposal already
 * exists (same action + same subject set), this is a no-op. */
export async function createApproval(input: ApprovalInput): Promise<{ id: string; created: boolean }> {
  const subjectKey = [...input.subjectIds].sort().join(",");
  const existing = await query<{ id: string }>(
    `MATCH (a:Approval {status: 'pending', action: $action, subjectKey: $subjectKey})
     RETURN a.id AS id LIMIT 1`,
    { action: input.action, subjectKey },
  );
  if (existing[0]) return { id: existing[0].id, created: false };

  const id = randomUUID();
  await query(
    `CREATE (a:Approval {id: $id, ts: $ts, status: 'pending', action: $action,
       title: $title, detail: $detail, ops: $ops, subjectIds: $subjectIds, subjectKey: $subjectKey})`,
    {
      id,
      ts: new Date().toISOString(),
      action: input.action,
      title: input.title,
      detail: input.detail,
      ops: JSON.stringify(input.ops),
      subjectIds: JSON.stringify(input.subjectIds),
      subjectKey,
    },
  );
  return { id, created: true };
}

/** Pending approvals, newest first. */
export async function listApprovals(): Promise<Approval[]> {
  const rows = await query<{ props: Record<string, string> }>(
    `MATCH (a:Approval {status: 'pending'}) RETURN properties(a) AS props ORDER BY a.ts DESC`,
  );
  return rows.map(({ props }) => ({
    id: props.id ?? "",
    ts: props.ts ?? "",
    action: (props.action as ApprovalAction) ?? "delete",
    title: props.title ?? "",
    detail: props.detail ?? "",
    subjectIds: safeIds(props.subjectIds),
  }));
}

export interface ResolveResult {
  ok: boolean;
  reason?: string;
  decision?: "approve" | "reject";
  opLogId?: string;
}

/**
 * Resolve a pending approval. `approve` replays the stored ops through the
 * single writer; `reject` marks it rejected and cools down the subject nodes so
 * the engine doesn't immediately re-propose the same action.
 */
export async function resolveApproval(id: string, decision: "approve" | "reject"): Promise<ResolveResult> {
  const rows = await query<{ props: Record<string, string> }>(
    `MATCH (a:Approval {id: $id}) RETURN properties(a) AS props`,
    { id },
  );
  const props = rows[0]?.props;
  if (!props) return { ok: false, reason: "not_found" };
  if (props.status !== "pending") return { ok: false, reason: "already_resolved" };

  const action = (props.action as ApprovalAction) ?? "delete";
  const subjectIds = safeIds(props.subjectIds);

  if (decision === "approve") {
    const ops = safeOps(props.ops);
    const res = await executeOps(ops, `approved ${action}: ${props.title}`);
    await query(`MATCH (a:Approval {id: $id}) SET a.status = 'approved', a.resolvedAt = $ts`, {
      id,
      ts: new Date().toISOString(),
    });
    return { ok: true, decision, opLogId: res.opLogId };
  }

  // reject → mark + cool down the subjects so we aren't re-asked next run.
  const until = new Date(Date.now() + REJECT_COOLDOWN_MS).toISOString();
  const prop = action === "merge" ? "mergeCooldownUntil" : "cleanupRejectedUntil";
  await query(
    `UNWIND $ids AS sid MATCH (n:Node {id: sid}) SET n.\`${prop}\` = $until`,
    { ids: subjectIds, until },
  );
  await query(`MATCH (a:Approval {id: $id}) SET a.status = 'rejected', a.resolvedAt = $ts`, {
    id,
    ts: new Date().toISOString(),
  });
  return { ok: true, decision };
}

function safeIds(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function safeOps(raw: string | undefined): GraphOp[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as GraphOp[]) : [];
  } catch {
    return [];
  }
}
