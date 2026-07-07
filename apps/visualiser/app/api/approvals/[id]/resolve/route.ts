import { GRAPH_CORE } from "../../../../../lib/services";

export const dynamic = "force-dynamic";

/** Allow (approve) or reject a pending cleanup proposal. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { decision } = (await req.json().catch(() => ({}))) as { decision?: "approve" | "reject" };
  if (decision !== "approve" && decision !== "reject") {
    return Response.json({ ok: false, reason: "bad_decision" }, { status: 400 });
  }
  try {
    const res = await fetch(`${GRAPH_CORE}/approvals/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    return Response.json(data, { status: res.ok ? 200 : 502 });
  } catch {
    return Response.json({ ok: false, reason: "graph_core_unreachable" }, { status: 502 });
  }
}
