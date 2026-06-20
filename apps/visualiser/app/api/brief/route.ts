import { GRAPH_CORE, getJson } from "../../../lib/services";

export const dynamic = "force-dynamic";

interface NodeRow {
  props: { id?: string; title?: string; summary?: string; asOf?: string };
}

export async function GET() {
  const { nodes } = await getJson<{ nodes: NodeRow[] }>(
    `${GRAPH_CORE}/nodes?type=WorldEvent&limit=20`,
    { nodes: [] },
  );
  const items = nodes
    .map((n) => ({
      id: n.props.id ?? "",
      title: n.props.title ?? "",
      summary: n.props.summary ?? "",
      asOf: n.props.asOf ?? "",
    }))
    .sort((a, b) => (b.asOf || "").localeCompare(a.asOf || ""))
    .slice(0, 5);
  return Response.json({ items });
}
