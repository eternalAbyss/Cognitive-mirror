import { NODE_TYPES, type NodeType } from "@cm/shared";
import { query, vecLiteral } from "./falkor.js";

/** Read-side queries. Structural mutations go through execute.ts; the only write
 * here is a fire-and-forget read-counter bump used for traversal-recency weighting. */

export interface NodeView {
  props: Record<string, unknown>;
  labels: string[];
  edges?: Array<{ type: string; to: string; toTitle: string | null }>;
}

function isNodeType(t: string): t is NodeType {
  return (NODE_TYPES as readonly string[]).includes(t);
}

/** Bump touchCount/lastReadAt so the daily brief can weight by recent traversal (design §12). */
function bumpTouch(ids: string[]): void {
  if (ids.length === 0) return;
  const ts = new Date().toISOString();
  void query(
    `UNWIND $ids AS id MATCH (n:Node {id: id})
     SET n.touchCount = coalesce(n.touchCount, 0) + 1, n.lastReadAt = $ts`,
    { ids, ts },
  ).catch(() => {});
}

export async function getNode(id: string): Promise<NodeView | null> {
  const rows = await query<{
    props: Record<string, unknown>;
    labels: string[];
    edges: Array<{ type: string; to: string; toTitle: string | null }>;
  }>(
    `MATCH (n:Node {id: $id})
     OPTIONAL MATCH (n)-[r]-(m:Node)
     WHERE m IS NULL OR (type(r) <> 'HAS_CHUNK' AND coalesce(m.archived,false) = false)
     RETURN properties(n) AS props, labels(n) AS labels,
            collect(CASE WHEN m IS NULL THEN null
                         ELSE {type: type(r), to: m.id, toTitle: m.title} END) AS edges`,
    { id },
  );
  const row = rows[0];
  if (!row) return null;
  bumpTouch([id]);
  return {
    props: row.props,
    labels: row.labels,
    edges: (row.edges ?? []).filter((e) => e !== null),
  };
}

export interface SemanticSearchParams {
  embedding: number[];
  k?: number;
  type?: NodeType;
}

export async function searchSemantic({
  embedding,
  k = 10,
  type,
}: SemanticSearchParams): Promise<Array<NodeView & { score: number }>> {
  const safeK = Math.max(1, Math.min(100, Math.floor(k)));
  const typeFilter = type && isNodeType(type) ? `AND '${type}' IN labels(node)` : "";
  const rows = await query<{
    props: Record<string, unknown>;
    labels: string[];
    score: number;
  }>(
    `CALL db.idx.vector.queryNodes('Node', 'summary_embedding', ${safeK}, ${vecLiteral(
      embedding,
    )}) YIELD node, score
     WHERE coalesce(node.archived, false) = false ${typeFilter}
     RETURN properties(node) AS props, labels(node) AS labels, score`,
  );
  return rows.map((r) => ({ props: r.props, labels: r.labels, score: r.score }));
}

/** RediSearch query operators that would otherwise make a raw user phrase a syntax error. */
function sanitizeFulltext(q: string): string {
  return q
    .replace(/[@!{}()|<>~*"\\:[\]^=%-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Keyword search over node title/summary via the full-text index (the lexical
 * complement to semantic search — exact terms, names, acronyms a vector misses).
 */
export async function searchText({
  query: q,
  k = 10,
  type,
}: {
  query: string;
  k?: number;
  type?: NodeType;
}): Promise<Array<NodeView & { score: number }>> {
  const safeQ = sanitizeFulltext(q);
  if (!safeQ) return [];
  const safeK = Math.max(1, Math.min(100, Math.floor(k)));
  const typeFilter = type && isNodeType(type) ? `AND '${type}' IN labels(node)` : "";
  const rows = await query<{
    props: Record<string, unknown>;
    labels: string[];
    score: number;
  }>(
    `CALL db.idx.fulltext.queryNodes('Node', $q) YIELD node, score
     WHERE coalesce(node.archived, false) = false ${typeFilter}
     RETURN properties(node) AS props, labels(node) AS labels, score
     ORDER BY score DESC
     LIMIT ${safeK}`,
    { q: safeQ },
  );
  return rows.map((r) => ({ props: r.props, labels: r.labels, score: r.score }));
}

export interface ChunkHit {
  id: string;
  text: string;
  sourceNodeId: string;
  score: number;
}

/** Content-chunk retrieval (design §11, content-chunk role) for grounded answers. */
export async function searchChunks(
  embedding: number[],
  k = 8,
): Promise<ChunkHit[]> {
  const safeK = Math.max(1, Math.min(100, Math.floor(k)));
  const rows = await query<{
    id: string;
    text: string;
    src: string;
    score: number;
  }>(
    `CALL db.idx.vector.queryNodes('Chunk', 'embedding', ${safeK}, ${vecLiteral(
      embedding,
    )}) YIELD node, score
     RETURN node.id AS id, node.text AS text, node.sourceNodeId AS src, score`,
  );
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    sourceNodeId: r.src,
    score: r.score,
  }));
}

export async function traverse(
  id: string,
  depth = 1,
  limit = 200,
): Promise<Array<NodeView & { distance: number }>> {
  const safeDepth = Math.max(1, Math.min(5, Math.floor(depth)));
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  const rows = await query<{
    props: Record<string, unknown>;
    labels: string[];
    distance: number;
  }>(
    `MATCH path = (a:Node {id: $id})-[*1..${safeDepth}]-(b:Node)
     WHERE coalesce(b.archived, false) = false
     RETURN DISTINCT properties(b) AS props, labels(b) AS labels, length(path) AS distance
     ORDER BY distance ASC
     LIMIT ${safeLimit}`,
    { id },
  );
  bumpTouch([id, ...rows.map((r) => String(r.props.id ?? "")).filter(Boolean)]);
  return rows.map((r) => ({ props: r.props, labels: r.labels, distance: r.distance }));
}
