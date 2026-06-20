import { GRAPH_CORE, getJson } from "../../../lib/services";

export const dynamic = "force-dynamic";

interface OpLogEntry {
  id: string;
  ts: string;
  reason?: string;
  ops?: Array<{ kind: string }>;
}

export async function GET() {
  const { entries } = await getJson<{ entries: OpLogEntry[] }>(`${GRAPH_CORE}/oplog?limit=24`, { entries: [] });
  return Response.json({
    entries: entries.map((e) => ({ id: e.id, ts: e.ts, reason: e.reason ?? "", ops: e.ops?.length ?? 0 })),
  });
}
