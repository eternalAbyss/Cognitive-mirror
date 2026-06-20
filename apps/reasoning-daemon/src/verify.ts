import { randomUUID } from "node:crypto";
import type { GraphOp } from "@cm/shared";
import { createGraphClient } from "@cm/graph-client";
import { embed } from "@cm/embeddings";

/**
 * Spine smoke test — exercises the real write/read code paths the daemon uses
 * (embed → execute → vector search), WITHOUT the Anthropic enrichment call, so
 * it runs with no API key. Verifies FalkorDB graph + native vector index +
 * the embedding pipeline end to end. Run: pnpm --filter @cm/reasoning-daemon verify
 */
const g = createGraphClient();
const sourceId = randomUUID();
const summary =
  "FalkorDB is a Cypher graph database with a native vector index, used here for both the knowledge graph structure and its embeddings.";

const summaryVec = await embed(summary);
const chunkVec = await embed("FalkorDB native vector index knowledge graph store");

const ops: GraphOp[] = [
  { kind: "createNode", id: sourceId, node: { type: "Source", title: "FalkorDB note", summary } },
  { kind: "setSummaryEmbedding", id: sourceId, embedding: summaryVec },
  {
    kind: "upsertChunk",
    chunk: { id: `${sourceId}:0`, sourceNodeId: sourceId, text: summary, ordinal: 0, embedding: chunkVec },
  },
];
const exec = await g.execute(ops, "verify spine");

const queryVec = await embed("which database stores both graph and vectors?");
const search = await g.searchSemantic({ embedding: queryVec, k: 5 });
const node = await g.getNode(sourceId);
const chunks = await g.searchChunks(queryVec, 3);
const oplog = await g.oplog(5);

console.log(
  JSON.stringify(
    {
      opLogId: exec.opLogId,
      writeResults: exec.results.map((r) => ({ kind: r.kind, ids: r.ids.length, error: r.error })),
      semanticHits: search.results.length,
      topHitTitle: search.results[0]?.props?.title,
      topHitScore: search.results[0]?.score,
      nodeFound: Boolean(node.props?.id),
      chunkHits: chunks.results.length,
      oplogEntries: oplog.entries.length,
    },
    null,
    2,
  ),
);
process.exit(0);
