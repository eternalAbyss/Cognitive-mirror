import { childLogger, JOB_TYPE_ENRICH, JOB_TYPE_WORLD_BRIEF, JOB_TYPE_MAINTENANCE, notify } from "@cm/shared";
import type { JobQueue } from "@cm/queue";
import type { GraphClient } from "@cm/graph-client";
import { enrichJob } from "./enrich.js";
import { runDailyBrief } from "./brief.js";
import { runMaintenance } from "./maintenance/index.js";
import { BudgetExceededError } from "./budget.js";

const log = childLogger("daemon:worker");

const IDLE_MS = 1_000;
const BUDGET_PAUSE_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Autonomous worker loop: lease a job, run it, complete or fail-with-backoff.
 * This is the execution path the original design lacked — background reasoning
 * driven by the Anthropic API, never by an interactive client.
 */
export function startWorker(queue: JobQueue, graph: GraphClient): () => void {
  let running = true;

  void (async () => {
    log.info("worker started");
    while (running) {
      const job = queue.lease();
      if (!job) {
        await sleep(IDLE_MS);
        continue;
      }
      try {
        if (job.type === JOB_TYPE_ENRICH) {
          await enrichJob(graph, job.payload);
          // Post-ingest maintenance (design §9), debounced to once per hour.
          const bucket = new Date().toISOString().slice(0, 13);
          queue.enqueue({ type: JOB_TYPE_MAINTENANCE, payload: {}, contentHash: `maintenance:${bucket}` });
        } else if (job.type === JOB_TYPE_WORLD_BRIEF) {
          await runDailyBrief(graph);
        } else if (job.type === JOB_TYPE_MAINTENANCE) {
          await runMaintenance(graph);
        } else {
          throw new Error(`unknown job type: ${job.type}`);
        }
        queue.complete(job.id);
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);
        if (err instanceof BudgetExceededError) {
          // Hitting the cap says nothing about the job — it was never attempted.
          // Releasing it (rather than failing it) keeps its attempt count intact;
          // otherwise five budget trips would permanently mark a perfectly good
          // job 'failed' and its captured content would be lost.
          queue.release(job.id, msg);
          log.warn({ jobId: job.id, msg }, "budget breaker tripped; re-queued job and pausing");
          void notify("API budget breaker tripped", msg, "high", ["dollar"]);
          await sleep(BUDGET_PAUSE_MS);
        } else {
          const before = queue.stats().failed;
          queue.fail(job.id, msg);
          log.warn({ jobId: job.id, err: msg }, "job failed; will retry with backoff");
          // Alert only when a job exhausts its retries (new 'failed' entry).
          if (queue.stats().failed > before) {
            void notify("Ingestion job failed", `${job.type} gave up after retries: ${msg}`, "high", ["warning"]);
          }
        }
      }
    }
    log.info("worker stopped");
  })();

  return () => {
    running = false;
  };
}
