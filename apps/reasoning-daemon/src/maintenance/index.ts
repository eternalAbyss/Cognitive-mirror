import { randomUUID } from "node:crypto";
import { embed } from "@cm/embeddings";
import type { GraphClient } from "@cm/graph-client";
import { type GraphOp, childLogger, loadConfig } from "@cm/shared";
import { adjudicatePair, synthesizeContradiction, synthesizeInsight } from "../anthropic.js";

const log = childLogger("daemon:maintenance");

export interface MaintenanceReport {
  candidates: number;
  merges: number;
  contradictions: number;
  related: number;
  insights: number;
  archived: number;
  conceptCount: number;
  /** merge/delete actions on user-edited notes deferred to the approval queue (design §9). */
  approvalsRequested: number;
}

/**
 * The maintenance engine (design §9): the graph self-manages. Runs the two-stage
 * merge/contradiction gate, synthesises on contradiction, detects cross-domain
 * Insights, and time-decay archives stale nodes. Every destructive op goes
 * through the single-writer execute primitive and is recorded in the op log
 * (with a 24h undo window).
 */
export async function runMaintenance(graph: GraphClient): Promise<MaintenanceReport> {
  const cfg = loadConfig();
  const report: MaintenanceReport = {
    candidates: 0,
    merges: 0,
    contradictions: 0,
    related: 0,
    insights: 0,
    archived: 0,
    conceptCount: 0,
    approvalsRequested: 0,
  };

  // ── Stage 1 + 2: merge / contradiction gate ────────────────────────────────
  const { candidates } = await graph.mergeCandidates(cfg.MERGE_CANDIDATE_DISTANCE);
  report.candidates = candidates.length;
  log.info({ candidates: candidates.length }, "stage-1 nominated candidate pairs");

  const touched = new Set<string>(); // don't act on a node twice in one pass
  for (const c of candidates) {
    if (touched.has(c.aId) || touched.has(c.bId)) continue;
    const adj = await adjudicatePair(
      { title: c.aTitle, summary: c.aSummary },
      { title: c.bTitle, summary: c.bSummary },
    );
    log.info(
      { a: c.aTitle, b: c.bTitle, verdict: adj.verdict, distance: Number(c.distance.toFixed(3)) },
      "adjudicated",
    );

    if (adj.verdict === "merge") {
      const ops: GraphOp[] = [];
      if (adj.mergedSummary) {
        ops.push({
          kind: "updateNode",
          id: c.bId,
          patch: {
            summary: adj.mergedSummary,
            ...(adj.mergedTitle ? { title: adj.mergedTitle } : {}),
          },
        });
        ops.push({
          kind: "setSummaryEmbedding",
          id: c.bId,
          embedding: await embed(adj.mergedSummary),
        });
      }
      ops.push({ kind: "tombstone", id: c.aId, survivorId: c.bId }); // a merges into b
      if (c.aEdited || c.bEdited) {
        // The user hand-edited one of these — don't merge silently; ask permission
        // (the ops are fully formed, so approving replays them with no further LLM call).
        const r = await graph.createApproval({
          action: "merge",
          title: `Merge "${c.aTitle}" → "${c.bTitle}"`,
          detail: adj.reason,
          ops,
          subjectIds: [c.aId, c.bId],
        });
        if (r.created) report.approvalsRequested++;
      } else {
        await graph.execute(ops, `merge: "${c.aTitle}" → "${c.bTitle}" (${adj.reason})`);
        report.merges++;
      }
      touched.add(c.aId).add(c.bId);
    } else if (adj.verdict === "contradiction") {
      await graph.execute(
        [
          {
            kind: "createEdge",
            from: c.aId,
            to: c.bId,
            type: "CONTRADICTS",
            props: { reason: adj.reason },
          },
        ],
        `contradiction: "${c.aTitle}" ✗ "${c.bTitle}"`,
      );
      const syn = await synthesizeContradiction(
        { title: c.aTitle, summary: c.aSummary },
        { title: c.bTitle, summary: c.bSummary },
      );
      const sid = randomUUID();
      await graph.execute(
        [
          {
            kind: "createNode",
            id: sid,
            node: { type: "Synthesis", title: syn.title, summary: syn.summary },
          },
          {
            kind: "setSummaryEmbedding",
            id: sid,
            embedding: await embed(syn.summary || syn.title),
          },
          { kind: "createEdge", from: sid, to: c.aId, type: "DERIVED_FROM" },
          { kind: "createEdge", from: sid, to: c.bId, type: "DERIVED_FROM" },
        ],
        `synthesise: "${syn.title}"`,
      );
      touched.add(c.aId).add(c.bId);
      report.contradictions++;
    } else if (adj.verdict === "related") {
      await graph.execute(
        [
          {
            kind: "createEdge",
            from: c.aId,
            to: c.bId,
            type: "RELATES_TO",
            props: { reason: adj.reason },
          },
        ],
        `relate: "${c.aTitle}" ~ "${c.bTitle}"`,
      );
      report.related++;
    }
    // "distinct" → no edge
  }

  // ── Cross-domain Insight detection (the marquee output, §9) ─────────────────
  const { pairs } = await graph.crossDomainEdges();
  for (const p of pairs.slice(0, cfg.MAX_INSIGHTS_PER_RUN)) {
    const ins = await synthesizeInsight(
      { title: p.aTitle, domain: p.aDomain },
      { title: p.bTitle, domain: p.bDomain },
    );
    if (!ins.title) continue; // model judged it shallow
    const iid = randomUUID();
    await graph.execute(
      [
        {
          kind: "createNode",
          id: iid,
          node: {
            type: "Insight",
            title: ins.title,
            summary: ins.summary,
            domain: `${p.aDomain}×${p.bDomain}`,
          },
        },
        { kind: "setSummaryEmbedding", id: iid, embedding: await embed(ins.summary || ins.title) },
        { kind: "createEdge", from: iid, to: p.aId, type: "DERIVED_FROM" },
        { kind: "createEdge", from: iid, to: p.bId, type: "DERIVED_FROM" },
      ],
      `insight: "${ins.title}"`,
    );
    report.insights++;
  }

  // ── Prune / time-decay archival (§9) ───────────────────────────────────────
  const prune = await pruneArchival(graph);
  report.archived = prune.archived;
  report.approvalsRequested += prune.approvals;

  const { counts } = await graph.counts();
  report.conceptCount = counts.Concept ?? 0;
  log.info(report, "maintenance complete");
  return report;
}

/**
 * Soft-archive stale Conversation/WorldEvent nodes (design §9): archived after an
 * inactivity window unless they're still open or carry a high-value (well-
 * connected) edge. Archived ≠ deleted — restorable indefinitely.
 */
async function pruneArchival(graph: GraphClient): Promise<{ archived: number; approvals: number }> {
  const cfg = loadConfig();
  const cutoff = Date.now() - cfg.ARCHIVE_INACTIVITY_DAYS * 86_400_000;
  const now = new Date().toISOString();
  let archived = 0;
  let approvals = 0;
  for (const type of ["Conversation", "WorldEvent"]) {
    const { nodes } = await graph.listNodes(type, 2000);
    const ops: GraphOp[] = [];
    for (const n of nodes) {
      const id = String(n.props.id ?? "");
      const last = Date.parse(
        String(n.props.lastReadAt ?? n.props.updatedAt ?? n.props.createdAt ?? ""),
      );
      const isOpen =
        typeof n.props.metadata === "string" && n.props.metadata.includes('"status":"open"');
      const highValue = n.degree >= 3; // cross-domain / well-connected → keep
      const rejectedUntil = String(n.props.cleanupRejectedUntil ?? "");
      if (rejectedUntil && rejectedUntil > now) continue; // user rejected archiving this recently
      if (id && !isOpen && Number.isFinite(last) && last < cutoff && !highValue) {
        if (n.props.edited) {
          // Hand-edited note — defer the delete to the approval queue instead of archiving.
          const r = await graph.createApproval({
            action: "delete",
            title: `Archive "${String(n.props.title ?? id)}"`,
            detail: `stale ${type} (>${cfg.ARCHIVE_INACTIVITY_DAYS}d inactive)`,
            ops: [{ kind: "softDeleteNode", id }],
            subjectIds: [id],
          });
          if (r.created) approvals++;
        } else {
          ops.push({ kind: "softDeleteNode", id });
        }
      }
    }
    if (ops.length) {
      await graph.execute(
        ops,
        `archive ${ops.length} stale ${type} (>${cfg.ARCHIVE_INACTIVITY_DAYS}d inactive)`,
      );
      archived += ops.length;
    }
  }
  return { archived, approvals };
}
