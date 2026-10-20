import { GRAPH_CORE, getJson } from "../../../lib/services";

export const dynamic = "force-dynamic";

interface NodeRow {
  props: {
    id?: string;
    title?: string;
    summary?: string;
    asOf?: string;
    lastReadAt?: string;
    touchCount?: number;
  };
  degree?: number;
}

type BriefKind = "world" | "concept" | "interest";

interface BriefItem {
  id: string;
  title: string;
  summary: string;
  asOf: string;
  kind: BriefKind;
}

async function nodesOfType(type: string, limit: number): Promise<NodeRow[]> {
  const { nodes } = await getJson<{ nodes: NodeRow[] }>(
    `${GRAPH_CORE}/nodes?type=${type}&limit=${limit}`,
    { nodes: [] },
  );
  return nodes;
}

/**
 * "From your graph" — the centre panel: the user's most active Concepts and
 * Interests, hottest first (recently read, then most-traversed, then
 * best-connected).
 *
 * This used to prefer the daemon's synthesised WorldEvent observations and fall
 * back to concepts only when none existed. Those observations now have their own
 * panel (`/api/news`), so preferring them here meant that the moment the first
 * brief landed, both panels showed the same five cards. The split follows the
 * labels: world signal is news, this is your graph.
 */
export async function GET() {
  const [concepts, interests] = await Promise.all([
    nodesOfType("Concept", 2000),
    nodesOfType("Interest", 2000),
  ]);
  const rank = (n: NodeRow) => Date.parse(n.props.lastReadAt ?? "") || 0;
  const items: BriefItem[] = [
    ...concepts.map((n) => ({ n, kind: "concept" as const })),
    ...interests.map((n) => ({ n, kind: "interest" as const })),
  ]
    .filter(({ n }) => n.props.id && (n.props.title || n.props.summary))
    .sort((a, b) => {
      const r = rank(b.n) - rank(a.n);
      if (r) return r;
      const t = (b.n.props.touchCount ?? 0) - (a.n.props.touchCount ?? 0);
      if (t) return t;
      return (b.n.degree ?? 0) - (a.n.degree ?? 0);
    })
    .slice(0, 5)
    .map(({ n, kind }) => ({
      id: n.props.id ?? "",
      title: n.props.title ?? "",
      summary: n.props.summary ?? "",
      asOf: (n.props.lastReadAt ?? "").slice(0, 10),
      kind,
    }));

  return Response.json({ items, source: "graph" });
}

// `nodesOfType` is still used above; WorldEvent now belongs to /api/news.
