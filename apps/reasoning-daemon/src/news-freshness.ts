import type { GraphClient } from "@cm/graph-client";
import type { JobQueue } from "@cm/queue";
import { childLogger, JOB_TYPE_WORLD_BRIEF, loadConfig } from "@cm/shared";

const log = childLogger("daemon:news");

export interface Freshness {
  /** ISO timestamp of the newest world observation, or null if there are none. */
  lastFetchedAt: string | null;
  /** Hours since that observation; null when there are none. */
  ageHours: number | null;
  stale: boolean;
  maxAgeHours: number;
}

export interface RefreshResult extends Freshness {
  /** true when this call actually put a brief job on the queue. */
  enqueued: boolean;
  reason: "forced" | "stale" | "fresh" | "already-queued";
}

/**
 * When the news last LANDED, from the newest WorldEvent's `createdAt`.
 *
 * `createdAt` deliberately, not `asOf`: `asOf` is the date the event itself is
 * about and is stored date-only, so a brief pulled at 09:00 reads as midnight
 * and would look 12 hours stale by mid-evening of the same day. Staleness here
 * means "how long since we fetched", which is what `createdAt` records.
 */
async function newestObservation(graph: GraphClient): Promise<string | null> {
  const { nodes } = await graph.listNodes("WorldEvent", 50);
  let newest = 0;
  let iso: string | null = null;
  for (const n of nodes) {
    const props = n.props as Record<string, unknown>;
    const raw = (props.createdAt ?? props.asOf ?? "") as string;
    const t = Date.parse(raw);
    if (Number.isFinite(t) && t > newest) {
      newest = t;
      iso = new Date(t).toISOString();
    }
  }
  return iso;
}

export async function newsFreshness(graph: GraphClient): Promise<Freshness> {
  const maxAgeHours = loadConfig().BRIEF_MAX_AGE_HOURS;
  const lastFetchedAt = await newestObservation(graph);
  if (!lastFetchedAt) {
    return { lastFetchedAt: null, ageHours: null, stale: true, maxAgeHours };
  }
  const ageHours = (Date.now() - Date.parse(lastFetchedAt)) / 3_600_000;
  return { lastFetchedAt, ageHours, stale: ageHours >= maxAgeHours, maxAgeHours };
}

/**
 * Pull a fresh world brief if the news has aged out — or unconditionally when
 * the user asks (`force`).
 *
 * This is deliberately NOT a second cron. The nightly `BRIEF_CRON` still runs;
 * this fires when someone actually looks at the dashboard and finds the news
 * stale, which is what keeps an app that isn't open all day from showing
 * yesterday's news the moment it is.
 *
 * Automatic refreshes are deduped on a `BRIEF_MAX_AGE_HOURS`-wide time bucket,
 * so the dashboard polling this every minute enqueues at most one brief per
 * window — the dedup lives in the durable queue, so it survives a restart too.
 * A forced refresh gets a unique hash, because "refresh" that silently does
 * nothing is worse than no button.
 */
export async function refreshNews(
  graph: GraphClient,
  queue: JobQueue,
  force = false,
): Promise<RefreshResult> {
  const fresh = await newsFreshness(graph);
  if (!force && !fresh.stale) return { ...fresh, enqueued: false, reason: "fresh" };

  const windowMs = Math.max(1, fresh.maxAgeHours) * 3_600_000;
  const contentHash = force
    ? `world_brief:manual:${Date.now()}`
    : `world_brief:stale:${Math.floor(Date.now() / windowMs)}`;
  const r = queue.enqueue({ type: JOB_TYPE_WORLD_BRIEF, payload: {}, contentHash });
  log.info({ force, enqueued: r.enqueued, ageHours: fresh.ageHours }, "news refresh requested");
  return {
    ...fresh,
    enqueued: r.enqueued,
    reason: force ? "forced" : r.enqueued ? "stale" : "already-queued",
  };
}
