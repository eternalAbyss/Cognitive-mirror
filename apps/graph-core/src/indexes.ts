import { childLogger, loadConfig } from "@cm/shared";
import { query } from "./falkor.js";

const log = childLogger("graph-core:indexes");

/**
 * Swallow "index already exists" so bootstrap is idempotent.
 *
 * The match is deliberately narrow. A bare `msg.includes("exist")` also
 * swallowed "graph does not exist" and "property does not exist", so a genuinely
 * failed index creation logged nothing and only surfaced much later as vector
 * searches that silently returned nothing.
 */
const ALREADY_EXISTS = /already\s+(indexed|exists)|attribute .* is already/i;

async function tryExec(label: string, cypher: string): Promise<void> {
  try {
    await query(cypher);
    log.info({ index: label }, "index ensured");
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (ALREADY_EXISTS.test(msg)) return;
    log.warn({ index: label, err: msg }, "index ensure failed (continuing)");
  }
}

/**
 * Create all indexes idempotently on boot (design §11: two embedding roles).
 * Vector index dimension must be a literal, so it is taken from EMBED_DIM.
 */
export async function ensureIndexes(): Promise<void> {
  const { EMBED_DIM } = loadConfig();

  // Exact-match / range lookups.
  await tryExec("Node.id", "CREATE INDEX FOR (n:Node) ON (n.id)");
  await tryExec("Node.type", "CREATE INDEX FOR (n:Node) ON (n.type)");
  await tryExec("Chunk.id", "CREATE INDEX FOR (c:Chunk) ON (c.id)");

  // Vector indexes — summary role (per knowledge node) and content-chunk role.
  await tryExec(
    "Node.summary_embedding",
    `CREATE VECTOR INDEX FOR (n:Node) ON (n.summary_embedding) OPTIONS {dimension:${EMBED_DIM}, similarityFunction:'cosine'}`,
  );
  await tryExec(
    "Chunk.embedding",
    `CREATE VECTOR INDEX FOR (c:Chunk) ON (c.embedding) OPTIONS {dimension:${EMBED_DIM}, similarityFunction:'cosine'}`,
  );

  // Full-text over title + summary — backs the keyword `searchText` path
  // (lexical complement to the vector index). Idempotent like the rest.
  await tryExec(
    "Node.fulltext",
    "CALL db.idx.fulltext.createNodeIndex('Node', 'title', 'summary')",
  );
}
