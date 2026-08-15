import { DAEMON, GRAPH_CORE, getJson } from "../../../lib/services";

export const dynamic = "force-dynamic";

export async function GET() {
  const [counts, status] = await Promise.all([
    getJson<{ counts: Record<string, number> }>(`${GRAPH_CORE}/stats/counts`, { counts: {} }),
    getJson<{ budget?: { spendUsd: number; dailyCap: number }; queue?: Record<string, number> }>(
      `${DAEMON}/status`,
      {},
    ),
  ]);
  return Response.json({
    counts: counts.counts,
    budget: status.budget ?? null,
    queue: status.queue ?? null,
  });
}
