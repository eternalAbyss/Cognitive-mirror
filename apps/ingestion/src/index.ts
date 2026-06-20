import { serve } from "@hono/node-server";
import { loadConfig, childLogger } from "@cm/shared";
import { JobQueue } from "@cm/queue";
import { startPolling } from "./github-poller.js";
import { buildIngestServer } from "./server.js";

const log = childLogger("ingestion");

function main(): void {
  const cfg = loadConfig();
  const queue = new JobQueue(cfg.QUEUE_DB_PATH);

  const stopPolling = startPolling(queue);

  const app = buildIngestServer(queue);
  const server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: cfg.INGESTION_PORT,
  });
  log.info(
    { port: cfg.INGESTION_PORT, repos: cfg.repoList.length },
    "ingestion listening (127.0.0.1)",
  );

  const shutdown = () => {
    log.info("shutting down");
    stopPolling();
    server.close();
    queue.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
