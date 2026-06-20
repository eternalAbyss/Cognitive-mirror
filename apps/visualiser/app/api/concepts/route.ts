import { GRAPH_CORE, getJson } from "../../../lib/services";

export const dynamic = "force-dynamic";

interface NodeRow {
  props: { id?: string; title?: string; summary?: string };
}

/** All active Concept nodes, for the clickable Concepts list. */
export async function GET() {
  const { nodes } = await getJson<{ nodes: NodeRow[] }>(
    `${GRAPH_CORE}/nodes?type=Concept&limit=2000`,
    { nodes: [] },
  );
  const concepts = nodes
    .map((n) => ({ id: n.props.id ?? "", title: n.props.title ?? "", summary: n.props.summary ?? "" }))
    .filter((c) => c.id)
    .sort((a, b) => a.title.localeCompare(b.title));
  return Response.json({ concepts });
}
