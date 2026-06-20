import { serve } from "@hono/node-server";
import { loadConfig, childLogger } from "@cm/shared";
import { buildApi } from "./api.js";
import { ensureIndexes } from "./indexes.js";
import { getGraph, closeGraph } from "./falkor.js";

const log = childLogger("graph-core");

async function main(): Promise<void> {
  const cfg = loadConfig();

  // Connect and bootstrap schema/indexes before accepting traffic.
  await getGraph();
  await ensureIndexes();
  log.info({ graph: cfg.FALKORDB_GRAPH }, "FalkorDB connected, indexes ensured");

  const app = buildApi();
  const server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: cfg.GRAPH_CORE_PORT,
  });
  log.info({ port: cfg.GRAPH_CORE_PORT }, "graph-core listening (127.0.0.1)");

  const shutdown = async () => {
    log.info("shutting down");
    server.close();
    await closeGraph();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error({ err: String(err?.stack ?? err) }, "fatal");
  process.exit(1);
});
