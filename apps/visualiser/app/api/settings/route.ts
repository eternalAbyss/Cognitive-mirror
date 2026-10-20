import { GRAPH_CORE, getJson } from "../../../lib/services";

export const dynamic = "force-dynamic";

/**
 * Runtime settings, proxied from graph-core (which owns the `.env` read/write).
 * Same pattern as every other route here: the browser stays same-origin and the
 * localhost-only services are never exposed. Secret values never reach this
 * process — graph-core sends presence, not content.
 */
export async function GET() {
  return Response.json(await getJson(`${GRAPH_CORE}/settings`, { groups: [], values: {} }));
}

export async function PATCH(req: Request) {
  const body = await req.text();
  try {
    const res = await fetch(`${GRAPH_CORE}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body,
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ ok: false, error: "graph-core is not reachable" }, { status: 502 });
  }
}
