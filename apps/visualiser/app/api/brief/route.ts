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
 * Daily Brief panel feed. Prefer the daemon's synthesised WorldEvent observations
 * (design §12). Until the brief job has run, fall back to the user's most active
 * Concepts/Interests — the same nodes the brief is scored against — so the panel
 * always surfaces relevant graph content on load instead of a dead-end prompt.
 */
export async function GET() {
  const world = await nodesOfType("WorldEvent", 20);
  if (world.length > 0) {
    const items: BriefItem[] = world
      .map((n) => ({
        id: n.props.id ?? "",
        title: n.props.title ?? "",
        summary: n.props.summary ?? "",
        asOf: n.props.asOf ?? "",
        kind: "world" as const,
      }))
      .sort((a, b) => (b.asOf || "").localeCompare(a.asOf || ""))
      .slice(0, 5);
    return Response.json({ items, source: "world" });
  }

  // Fallback: most-active concepts/interests, hottest first (recently read, then
  // most-traversed, then best-connected).
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
