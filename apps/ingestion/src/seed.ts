import { JobQueue } from "@cm/queue";
import { childLogger, type EnrichPayload, JOB_TYPE_ENRICH, loadConfig } from "@cm/shared";
import { contentHash } from "./hash.js";

/**
 * Inject one sample enrich job so the full Phase-1 path (queue → daemon →
 * enrichment → graph) can be verified end-to-end without GitHub/network.
 * Run with `pnpm seed`.
 */
const log = childLogger("ingestion:seed");

const SAMPLE: EnrichPayload = {
  kind: "note",
  title: "FalkorDB replaces Kuzu as the graph store",
  text: `Kuzu, the embedded graph database the original PKM design picked, was archived in
October 2025 after the team was acqui-hired by Apple. We replaced it with FalkorDB — an
actively maintained, Cypher-speaking graph database purpose-built for LLM knowledge graphs
(GraphRAG), with a native vector index. That let us also drop Qdrant and keep graph structure
and embeddings in a single store. The Core Graph Service remains the single writer.`,
  source: "seed:manual",
  occurredAt: new Date().toISOString(),
};

function main(): void {
  const cfg = loadConfig();
  const queue = new JobQueue(cfg.QUEUE_DB_PATH);
  const r = queue.enqueue({
    type: JOB_TYPE_ENRICH,
    payload: SAMPLE,
    contentHash: contentHash(SAMPLE.source, SAMPLE.text),
  });
  log.info(r, r.enqueued ? "seed job enqueued" : "seed job already present (idempotent)");
  queue.close();
}

main();
