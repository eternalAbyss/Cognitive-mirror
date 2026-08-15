import { GRAPH_CORE, getJson } from "../../../lib/services";

export const dynamic = "force-dynamic";

interface NodeRow {
  props: { id?: string; title?: string; summary?: string };
}

/** Active nodes of a given type, for the clickable type-list panels (Concepts,
 * Insights, Syntheses, World Events…). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";
  const limit = url.searchParams.get("limit") ?? "2000";
  if (!type) return Response.json({ nodes: [] });

  const { nodes } = await getJson<{ nodes: NodeRow[] }>(
    `${GRAPH_CORE}/nodes?type=${encodeURIComponent(type)}&limit=${encodeURIComponent(limit)}`,
    { nodes: [] },
  );
  const items = nodes
    .map((n) => ({
      id: n.props.id ?? "",
      title: n.props.title ?? "",
      summary: n.props.summary ?? "",
    }))
    .filter((n) => n.id)
    .sort((a, b) => a.title.localeCompare(b.title));
  return Response.json({ nodes: items });
}
