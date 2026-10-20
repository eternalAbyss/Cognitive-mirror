import { DAEMON } from "../../../lib/services";

export const dynamic = "force-dynamic";

/**
 * Grounded answer for the ask bar: the daemon retrieves from the graph and
 * synthesises over what it found.
 *
 * Every failure degrades to `{ ok: false, reason }` rather than an HTTP error,
 * because the caller already has the raw search hits and falls back to showing
 * those. A missing API key and a stopped daemon both mean "no synthesis right
 * now", not "the ask bar is broken".
 */
export async function POST(req: Request) {
  const { question } = (await req.json()) as { question?: string };
  if (!question?.trim()) return Response.json({ ok: false, reason: "no_context" });
  try {
    const res = await fetch(`${DAEMON}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
      // Retrieval plus a Sonnet call; the sphere keeps animating meanwhile.
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return Response.json({ ok: false, reason: "llm_failed" });
    return Response.json(await res.json());
  } catch {
    return Response.json({ ok: false, reason: "daemon_unreachable" });
  }
}
