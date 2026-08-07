import { DAEMON } from "../../../lib/services";

export const dynamic = "force-dynamic";

/** Live web research for a topic the graph couldn't answer → notes written by the daemon. */
export async function POST(req: Request) {
  const { topic } = (await req.json()) as { topic?: string };
  if (!topic?.trim()) return Response.json({ ok: false, error: "missing topic" });
  try {
    const res = await fetch(`${DAEMON}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic }),
    });
    if (!res.ok)
      return Response.json({ ok: false, error: `daemon research failed (${res.status})` });
    return Response.json(await res.json());
  } catch {
    return Response.json({ ok: false, error: "reasoning daemon unreachable" });
  }
}
