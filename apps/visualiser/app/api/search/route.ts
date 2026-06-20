import { GRAPH_CORE, embed } from "../../../lib/services";

export const dynamic = "force-dynamic";

interface Hit {
  props: { id?: string; title?: string; summary?: string; type?: string };
  score: number;
}

/** Live "ask": embed the query, vector-search the real graph, return the hits to animate. */
export async function POST(req: Request) {
  const { query } = (await req.json()) as { query?: string };
  if (!query?.trim()) return Response.json({ results: [] });
  const embedding = await embed(query);
  if (embedding.length === 0) return Response.json({ results: [], error: "embed_failed" });
  const res = await fetch(`${GRAPH_CORE}/search/semantic`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embedding, k: 6 }),
  });
  const data = res.ok ? ((await res.json()) as { results: Hit[] }) : { results: [] as Hit[] };
  return Response.json({
    results: data.results.map((h) => ({
      id: h.props.id ?? "",
      title: h.props.title ?? "",
      summary: h.props.summary ?? "",
      type: h.props.type ?? "",
      score: h.score,
    })),
  });
}
