import { GRAPH_CORE, embed, getJson } from "../../../../lib/services";

export const dynamic = "force-dynamic";

type Op = Record<string, unknown>;

async function execute(ops: Op[], reason: string): Promise<{ ok: boolean; opLogId?: string }> {
  try {
    const res = await fetch(`${GRAPH_CORE}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops, reason }),
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as { opLogId?: string };
    return { ok: true, opLogId: data.opLogId };
  } catch {
    return { ok: false };
  }
}

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

/** Soft-delete (archive) a node — hidden from UI + sphere, restorable via op-log undo. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await execute([{ kind: "softDeleteNode", id }], `user deleted via UI: ${id}`);
  return Response.json(r, { status: r.ok ? 200 : 502 });
}

/** Edit a note's title/summary, mark it user-edited, and re-embed so search/merge stay consistent. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { title?: string; summary?: string };
  const title = (body.title ?? "").trim();
  const summary = body.summary ?? "";
  const patch: Record<string, unknown> = {
    summary,
    edited: true,
    editedAt: new Date().toISOString(),
  };
  if (title) patch.title = title;

  const ops: Op[] = [{ kind: "updateNode", id, patch }];
  const embedding = await embed(summary || title).catch(() => [] as number[]);
  if (embedding.length) ops.push({ kind: "setSummaryEmbedding", id, embedding });

  const r = await execute(ops, `user edited via UI: ${title || id}`);
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
