import { GRAPH_CORE, getJson } from "../../../lib/services";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    await getJson(`${GRAPH_CORE}/graph?limit=1200`, { nodes: [], edges: [] }),
  );
}
