import { z } from "zod";
import { EdgeTypeSchema, NewNodeSchema } from "./schema.js";

/**
 * The transactional mutation primitive (design §13 Q1):
 * `execute_graph_operations(ops[])` is the sole write path into the graph.
 * Atomic tools are thin wrappers that build a single-element ops array.
 *
 * Embedding writes (`upsertChunk`, `setSummaryEmbedding`) also flow through here
 * so the Core Graph Service stays the single owner of both structure and vectors.
 */

const CreateNode = z.object({
  kind: z.literal("createNode"),
  node: NewNodeSchema,
  /** Optional caller-supplied id to make the op idempotent / referenceable. */
  id: z.string().uuid().optional(),
});

/**
 * Property names a patch may never carry.
 *
 * `updateNode` compiles down to `SET n += $patch`, which will happily overwrite
 * anything. These particular keys are load-bearing invariants rather than
 * ordinary content:
 *  - `id`          the node's identity, referenced by every edge and op-log entry
 *  - `type`        mirrored as a Cypher *label* (`:Node:Concept`) that a property
 *                  write would not follow, desynchronising the two
 *  - `archived`    a patch could silently resurrect a tombstoned node
 *  - `createdAt`   append-only provenance
 *  - `externalId`  the dedup key; hijacking it makes future upserts land on the
 *                  wrong node
 *  - `summary_embedding` must go through `setSummaryEmbedding`, which enforces
 *                  the EMBED_DIM the vector index was built with
 */
export const PROTECTED_NODE_PROPS = [
  "id",
  "type",
  "archived",
  "createdAt",
  "externalId",
  "summary_embedding",
] as const;

/**
 * Property names must be plain identifiers.
 *
 * Beyond hygiene this is a security boundary: the rollback path in graph-core
 * interpolates patch keys directly into a Cypher `REMOVE n.\`key\`` clause, so an
 * unconstrained key is an injection primitive. Validating here keeps the check
 * on the one schema every write already passes through.
 */
const PropertyNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "property names must be plain identifiers")
  .max(128)
  .refine(
    (k) => !(PROTECTED_NODE_PROPS as readonly string[]).includes(k),
    (k) => ({ message: `'${k}' is a protected property and cannot be patched` }),
  );

const UpdateNode = z.object({
  kind: z.literal("updateNode"),
  id: z.string().uuid(),
  patch: z.record(PropertyNameSchema, z.unknown()),
});

const SoftDeleteNode = z.object({
  kind: z.literal("softDeleteNode"),
  id: z.string().uuid(),
});

const CreateEdge = z.object({
  kind: z.literal("createEdge"),
  from: z.string().uuid(),
  to: z.string().uuid(),
  type: EdgeTypeSchema,
  props: z.record(PropertyNameSchema, z.unknown()).optional(),
});

const Tombstone = z.object({
  kind: z.literal("tombstone"),
  id: z.string().uuid(),
  survivorId: z.string().uuid(),
});

const UpsertChunk = z.object({
  kind: z.literal("upsertChunk"),
  chunk: z.object({
    id: z.string(),
    sourceNodeId: z.string().uuid(),
    text: z.string(),
    ordinal: z.number().int().nonnegative(),
    embedding: z.array(z.number()),
  }),
});

const SetSummaryEmbedding = z.object({
  kind: z.literal("setSummaryEmbedding"),
  id: z.string().uuid(),
  embedding: z.array(z.number()),
});

export const GraphOpSchema = z.discriminatedUnion("kind", [
  CreateNode,
  UpdateNode,
  SoftDeleteNode,
  CreateEdge,
  Tombstone,
  UpsertChunk,
  SetSummaryEmbedding,
]);
export type GraphOp = z.infer<typeof GraphOpSchema>;

export const ExecuteRequestSchema = z.object({
  ops: z.array(GraphOpSchema).min(1),
  /** Human/agent-readable reason recorded in the operation log. */
  reason: z.string().optional(),
});
export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;

export interface SubOpResult {
  kind: GraphOp["kind"];
  /** ids created/affected by this sub-op. */
  ids: string[];
  error?: string;
}

export interface ExecuteResult {
  opLogId: string;
  results: SubOpResult[];
}

/** One operation-log entry per execute() batch (design §9 "every destructive op writes to the log"). */
export interface OpLogEntry {
  id: string;
  ts: string;
  reason?: string;
  ops: GraphOp[];
  /** Undo window for automated destructive ops (design §9: 24h undo window). */
  undoUntil?: string;
}
