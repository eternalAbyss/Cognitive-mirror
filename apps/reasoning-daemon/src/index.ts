import { loadConfig, childLogger } from "@cm/shared";
import { JobQueue } from "@cm/queue";
import { createGraphClient } from "@cm/graph-client";
import { startWorker } from "./worker.js";
import { startScheduler } from "./scheduler.js";
import { startHealthProbe } from "./health.js";
import { startStatusServer } from "./status-server.js";
import { ensureEmbedModel } from "./embeddings.js";

const log = childLogger("reasoning-daemon");

async function main(): Promise<void> {
  const cfg = loadConfig();
  await ensureEmbedModel();

  const queue = new JobQueue(cfg.QUEUE_DB_PATH);
  const graph = createGraphClient();
  const stopWorker = startWorker(queue, graph);
  const stopScheduler = startScheduler(queue);
  const stopHealth = startHealthProbe();
  const stopStatus = startStatusServer(queue, graph);
  log.info("reasoning daemon up (autonomous path)");

  const shutdown = () => {
    log.info("shutting down");
    stopWorker();
    stopScheduler();
    stopHealth();
    stopStatus();
    queue.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error({ err: String(err?.stack ?? err) }, "fatal");
  process.exit(1);
});
