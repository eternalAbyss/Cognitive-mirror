import { z } from "zod";

/**
 * Knowledge-graph node schema (design §8).
 *
 * Every knowledge node carries the generic `Node` label in FalkorDB plus its
 * specific type label (e.g. `:Node:Concept`), so a single vector index over
 * `Node.summary_embedding` covers semantic search across all types.
 *
 * `ContentChunk` (label `:Chunk`) is an embedding artifact, not a knowledge
 * node — it is handled separately by the embedding ops and is not part of this
 * union.
 */
export const NODE_TYPES = [
  "Concept",
  "Source",
  "Conversation",
  "Interest",
  "WorldEvent",
  "Synthesis",
  "Insight",
  "Tombstone",
] as const;

export const NodeTypeSchema = z.enum(NODE_TYPES);
export type NodeType = z.infer<typeof NodeTypeSchema>;

/** Relationship types (design §8). */
export const EDGE_TYPES = [
  "RELATES_TO",
  "CONTRADICTS",
  "DERIVED_FROM",
  "MENTIONS",
  "MERGED_INTO", // tombstone -> survivor
] as const;

export const EdgeTypeSchema = z.enum(EDGE_TYPES);
export type EdgeType = z.infer<typeof EdgeTypeSchema>;

/** ISO date string (YYYY-MM-DD or full ISO). */
const DateString = z.string().min(4);

/**
 * Persisted node properties. `confidence` + `asOf` are meaningful chiefly on
 * Source and Conversation (design §8: claims carry confidence), but allowed on
 * any node so the contradiction example is representable.
 */
export const GraphNodeSchema = z.object({
  id: z.string().uuid(),
  type: NodeTypeSchema,
  title: z.string(),
  summary: z.string().default(""),
  content: z.string().optional(),
  domain: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  asOf: DateString.optional(),
  archived: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * Stable external identity for a re-ingestible artifact (e.g. "github:owner/repo").
   * When set, enrichment upserts on it so re-pulling the same artifact updates the
   * existing node instead of creating a duplicate (design §2 idempotency).
   */
  externalId: z.string().optional(),
  /** Free-form provenance / source metadata, JSON-stringified at the storage layer. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

/** Input shape for creating a node (id/timestamps filled in by graph-core). */
export const NewNodeSchema = GraphNodeSchema.partial({
  id: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
  summary: true,
});
export type NewNode = z.infer<typeof NewNodeSchema>;

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  props?: Record<string, unknown>;
}

/** A content chunk with its embedding (design §11, content-chunk role). */
export interface ContentChunk {
  id: string;
  sourceNodeId: string;
  text: string;
  ordinal: number;
  embedding: number[];
}
