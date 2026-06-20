import { childLogger } from "@cm/shared";
import { getGraph, query, closeGraph } from "./falkor.js";

/**
 * Wipe ALL graph data (nodes, edges, chunks, op-log) for a fresh start.
 * Indexes are schema and survive the delete. Run with the stack stopped so the
 * SQLite queue file can also be cleared (see the root `reset` script).
 *
 *   pnpm reset            (clears graph + queue)
 *   pnpm --filter @cm/graph-core reset   (graph only)
 */
const log = childLogger("graph-core:reset");

await getGraph();
const before = await query<{ n: number }>("MATCH (n) RETURN count(n) AS n");
await query("MATCH (n) DETACH DELETE n");
log.info({ deleted: before[0]?.n ?? 0 }, "graph cleared — fresh start");
await closeGraph();
process.exit(0);
