import { GRAPH_CORE, getJson } from "../../../../lib/services";

export const dynamic = "force-dynamic";

/** Full detail for one node: properties + outgoing connections (design §2 node card). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getJson(`${GRAPH_CORE}/node/${encodeURIComponent(id)}`, {
    props: {},
    labels: [],
    edges: [],
  });
  return Response.json(data);
}
