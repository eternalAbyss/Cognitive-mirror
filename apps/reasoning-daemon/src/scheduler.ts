import type { JobQueue } from "@cm/queue";
import { JOB_TYPE_MAINTENANCE, JOB_TYPE_WORLD_BRIEF, childLogger, loadConfig } from "@cm/shared";
import cron from "node-cron";

const log = childLogger("daemon:scheduler");

/** Schedule the daily world brief (§12) and nightly maintenance (§9). Returns a stop fn. */
export function startScheduler(queue: JobQueue): () => void {
  const cfg = loadConfig();
  const tasks: Array<{ stop: () => void }> = [];

  if (cron.validate(cfg.BRIEF_CRON)) {
    tasks.push(
      cron.schedule(cfg.BRIEF_CRON, () => {
        const day = new Date().toISOString().slice(0, 10);
        const r = queue.enqueue({
          type: JOB_TYPE_WORLD_BRIEF,
          payload: {},
          contentHash: `world_brief:${day}`,
        });
        log.info({ day, enqueued: r.enqueued }, "daily brief scheduled");
      }),
    );
  } else {
    log.warn({ BRIEF_CRON: cfg.BRIEF_CRON }, "invalid BRIEF_CRON; brief not scheduled");
  }

  if (cron.validate(cfg.MAINTENANCE_CRON)) {
    tasks.push(
      cron.schedule(cfg.MAINTENANCE_CRON, () => {
        const day = new Date().toISOString().slice(0, 10);
        const r = queue.enqueue({
          type: JOB_TYPE_MAINTENANCE,
          payload: {},
          contentHash: `maintenance:nightly:${day}`,
        });
        log.info({ day, enqueued: r.enqueued }, "nightly maintenance scheduled");
      }),
    );
  } else {
    log.warn(
      { MAINTENANCE_CRON: cfg.MAINTENANCE_CRON },
      "invalid MAINTENANCE_CRON; maintenance not scheduled",
    );
  }

  log.info(
    { BRIEF_CRON: cfg.BRIEF_CRON, MAINTENANCE_CRON: cfg.MAINTENANCE_CRON },
    "scheduler started",
  );
  return () => tasks.forEach((t) => t.stop());
}
