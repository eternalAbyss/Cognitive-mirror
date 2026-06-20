import { NODE_TYPES, type NodeType } from "@cm/shared";
import { query } from "./falkor.js";

/**
 * Read-side support for the maintenance engine (design §9). The Stage-1 merge
 * gate is a vector self-join over the Concept summary embeddings: for each
 * Concept, its nearest Concept neighbours within a distance threshold become
 * candidate pairs for LLM adjudication.
 *
 * NOTE on thresholds: the doc cites ~0.93 cosine *similarity*, but that figure
 * was for a different embedder. With nomic-embed-text these short summaries sit
 * tighter, so callers pass a distance threshold calibrated to this model. Stage 1
 * is deliberately generous; Stage 2 (the LLM) makes the real decision.
 */
export interface MergeCandidate {
  aId: string;
  aTitle: string;
  aSummary: string;
  bId: string;
  bTitle: string;
  bSummary: string;
  distance: number;
}

export async function mergeCandidates(
  maxDistance: number,
  perNode = 5,
): Promise<MergeCandidate[]> {
  const k = Math.max(2, Math.min(20, Math.floor(perNode) + 1));
  const max = Number.isFinite(maxDistance) ? maxDistance : 0.3;
  const now = new Date().toISOString();
  // node.id < c.id dedupes each unordered pair to a single row.
  return query<MergeCandidate>(
    `MATCH (c:Node:Concept)
     WHERE c.summary_embedding IS NOT NULL AND coalesce(c.archived,false)=false
       AND coalesce(c.mergeCooldownUntil,'') < $now
     CALL db.idx.vector.queryNodes('Node','summary_embedding', ${k}, c.summary_embedding) YIELD node, score
     WHERE node.id < c.id AND 'Concept' IN labels(node)
       AND coalesce(node.archived,false)=false
       AND coalesce(node.mergeCooldownUntil,'') < $now
       AND score <= ${max}
     RETURN node.id AS aId, node.title AS aTitle, coalesce(node.summary,'') AS aSummary,
            c.id AS bId, c.title AS bTitle, coalesce(c.summary,'') AS bSummary, score AS distance
     ORDER BY score ASC`,
    { now },
  );
}

export async function countsByType(): Promise<Record<string, number>> {
  const rows = await query<{ type: string; count: number }>(
    `MATCH (n:Node) WHERE coalesce(n.archived,false)=false
     RETURN n.type AS type, count(*) AS count`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.type] = r.count;
  return out;
}

export interface ListedNode {
  props: Record<string, unknown>;
  degree: number;
}

/** Active nodes of a type with their degree — used by the prune scanner. */
export async function listByType(type: string, limit = 1000): Promise<ListedNode[]> {
  if (!(NODE_TYPES as readonly string[]).includes(type)) return [];
  const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
  return query<ListedNode>(
    `MATCH (n:Node:${type as NodeType}) WHERE coalesce(n.archived,false)=false
     OPTIONAL MATCH (n)-[r]-(:Node)
     RETURN properties(n) AS props, count(r) AS degree
     LIMIT ${safeLimit}`,
  );
}

/** Concept↔Concept edges whose endpoints have different domains (cross-domain, design §9). */
export interface CrossDomainPair {
  aId: string;
  aTitle: string;
  aDomain: string;
  bId: string;
  bTitle: string;
  bDomain: string;
}

export async function crossDomainEdges(limit = 200): Promise<CrossDomainPair[]> {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  return query<CrossDomainPair>(
    `MATCH (a:Node:Concept)-[:RELATES_TO]->(b:Node:Concept)
     WHERE a.domain IS NOT NULL AND b.domain IS NOT NULL AND a.domain <> b.domain
       AND coalesce(a.archived,false)=false AND coalesce(b.archived,false)=false
       AND NOT (a)-[:DERIVED_FROM]-(:Node:Insight)
     RETURN a.id AS aId, a.title AS aTitle, a.domain AS aDomain,
            b.id AS bId, b.title AS bTitle, b.domain AS bDomain
     LIMIT ${safeLimit}`,
  );
}

/** A whole-graph snapshot for the visualiser (design §15 Phase 4). */
export interface GraphSnapshot {
  nodes: Array<{ id: string; title: string; type: string; domain: string; summary: string }>;
  edges: Array<{ from: string; to: string; type: string }>;
}

export async function graphSnapshot(limit = 1200): Promise<GraphSnapshot> {
  const safe = Math.max(1, Math.min(5000, Math.floor(limit)));
  const nodes = await query<{ id: string; title: string; type: string; domain: string; summary: string }>(
    `MATCH (n:Node) WHERE coalesce(n.archived,false)=false
     RETURN n.id AS id, n.title AS title, n.type AS type,
            coalesce(n.domain,'') AS domain, coalesce(n.summary,'') AS summary
     LIMIT ${safe}`,
  );
  const edges = await query<{ from: string; to: string; type: string }>(
    `MATCH (a:Node)-[r]->(b:Node)
     WHERE coalesce(a.archived,false)=false AND coalesce(b.archived,false)=false
       AND type(r) <> 'HAS_CHUNK'
     RETURN a.id AS from, b.id AS to, type(r) AS type
     LIMIT ${safe * 3}`,
  );
  return { nodes, edges };
}

/** Open Conversation loops ranked for resurfacing (design §9): recency × degree. */
export interface ResurfaceItem {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
  degree: number;
}

export async function resurfaceQueue(limit = 5): Promise<ResurfaceItem[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const rows = await query<{ props: Record<string, unknown>; degree: number }>(
    `MATCH (n:Node:Conversation)
     WHERE coalesce(n.archived,false)=false
       AND coalesce(n.metadata,'') CONTAINS '"status":"open"'
     OPTIONAL MATCH (n)-[r]-(:Node)
     RETURN properties(n) AS props, count(r) AS degree`,
  );
  return rows
    .map((r) => ({
      id: String(r.props.id ?? ""),
      title: String(r.props.title ?? ""),
      summary: String(r.props.summary ?? ""),
      updatedAt: String(r.props.updatedAt ?? r.props.createdAt ?? ""),
      degree: r.degree,
    }))
    .sort((a, b) => {
      // recency × parent-concept activity (degree), as the design specifies.
      const score = (x: ResurfaceItem) => Date.parse(x.updatedAt || "0") / 1e10 + x.degree;
      return score(b) - score(a);
    })
    .slice(0, safeLimit);
}
