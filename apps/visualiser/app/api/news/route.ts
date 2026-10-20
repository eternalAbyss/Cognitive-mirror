import { DAEMON, GRAPH_CORE, getJson } from "../../../lib/services";

export const dynamic = "force-dynamic";

interface NodeRow {
  props: { id?: string; title?: string; summary?: string; asOf?: string; url?: string };
}

interface Freshness {
  lastFetchedAt: string | null;
  ageHours: number | null;
  stale: boolean;
  maxAgeHours: number;
}

async function items() {
  const { nodes } = await getJson<{ nodes: NodeRow[] }>(
    `${GRAPH_CORE}/nodes?type=WorldEvent&limit=40`,
    { nodes: [] },
  );
  return nodes
    .map((n) => ({
      id: n.props.id ?? "",
      title: n.props.title ?? "",
      summary: n.props.summary ?? "",
      asOf: n.props.asOf ?? "",
      url: n.props.url ?? "",
    }))
    .filter((n) => n.id && n.title)
    .sort((a, b) => (b.asOf || "").localeCompare(a.asOf || ""))
    .slice(0, 6);
}

/**
 * Latest world observations scored against your concepts, plus how stale they
 * are.
 *
 * Reading this is what triggers a refresh: if the newest observation has aged
 * past `BRIEF_MAX_AGE_HOURS` the daemon queues a fresh brief. That is the whole
 * point — nothing fires on a clock, so an app that isn't open all day doesn't
 * greet you with yesterday's news. The daemon dedups on a time bucket in the
 * durable queue, so polling this endpoint can't stack up briefs.
 */
export async function GET() {
  const [news, fresh] = await Promise.all([
    items(),
    getJson<Freshness>(`${DAEMON}/news/freshness`, {
      lastFetchedAt: null,
      ageHours: null,
      stale: false,
      maxAgeHours: 12,
    }),
  ]);

  let refreshing = false;
  if (fresh.stale) {
    try {
      const res = await fetch(`${DAEMON}/news/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const r = (await res.json()) as { enqueued?: boolean; reason?: string };
      refreshing = r.enqueued === true || r.reason === "already-queued";
    } catch {
      /* daemon down — the panel still renders what's in the graph */
    }
  }
  return Response.json({ items: news, ...fresh, refreshing });
}

/** Force a refresh now, regardless of age — the panel's refresh button. */
export async function POST() {
  try {
    const res = await fetch(`${DAEMON}/news/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json(
      { ok: false, error: "the reasoning daemon is not reachable" },
      { status: 502 },
    );
  }
}
