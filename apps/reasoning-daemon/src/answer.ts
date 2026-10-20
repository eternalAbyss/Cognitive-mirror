import type { GraphClient, SemanticHit } from "@cm/graph-client";
import { childLogger } from "@cm/shared";
import { answerFromGraph } from "./anthropic.js";
import { embed } from "./embeddings.js";

const log = childLogger("daemon:answer");

/** How many semantic hits to pull before merging. Over-fetched: the vector index
 *  returns a global top-k and graph-core filters afterwards, so a tight k loses
 *  real matches to archived or off-type rows. */
const SEMANTIC_K = 24;
/** Literal-term search runs alongside the vector one — exact names ("FalkorDB",
 *  "Van der Corput") are precisely what embeddings blur away. */
const TEXT_K = 12;
/** Nodes handed to the model. Beyond this the context is mostly noise and the
 *  answer starts averaging over things the question never asked about. */
const CONTEXT_NODES = 14;
/** Top hits whose neighbours get pulled in — "what connects to what" is the
 *  question this graph exists to answer, so the edges have to be in context. */
const EXPAND_TOP = 4;
const EXPAND_LIMIT = 8;

export interface AnswerCitation {
  id: string;
  title: string;
  type: string;
}

export interface AnswerOutcome {
  ok: boolean;
  /**
   * Why there is no synthesised answer. The caller falls back to its own
   * retrieval summary rather than showing an error, so these are informational:
   *  - `no_context`  retrieval came back empty
   *  - `no_api_key`  no ANTHROPIC_API_KEY in env or Keychain
   *  - `budget`      the spend breaker is open
   *  - `llm_failed`  the call or its JSON failed
   */
  reason?: "no_context" | "no_api_key" | "budget" | "llm_failed";
  answer?: string;
  citations?: AnswerCitation[];
  /**
   * false when the answer is "your graph does not hold this". The caller turns
   * that into the offer to research the topic on the web — which is the one
   * useful thing to do about a gap, so it must not be lost just because the
   * model explained the gap well.
   */
  inGraph?: boolean;
  /** Whole-graph totals by type, as given to the model. */
  counts?: Record<string, number>;
}

interface ContextNode {
  id: string;
  title: string;
  type: string;
  domain: string;
  summary: string;
  score: number;
  connections: string[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function typeOf(hit: { labels?: string[]; props: Record<string, unknown> }): string {
  const fromProps = str(hit.props.type);
  if (fromProps) return fromProps;
  return (hit.labels ?? []).find((l) => l !== "Node") ?? "Node";
}

/**
 * Merge the vector and literal result sets, keeping the better score per node.
 * Both are cosine DISTANCES (lower is closer), so "better" is the minimum.
 */
function merge(...sets: SemanticHit[][]): SemanticHit[] {
  const best = new Map<string, SemanticHit>();
  for (const set of sets) {
    for (const hit of set) {
      const id = str(hit.props.id);
      if (!id) continue;
      const prev = best.get(id);
      if (!prev || hit.score < prev.score) best.set(id, hit);
    }
  }
  return [...best.values()].sort((a, b) => a.score - b.score);
}

/**
 * Answer a question from the graph: retrieve, expand along edges, then let the
 * model synthesise over what was actually found.
 *
 * The retrieval half is deliberately not the visualiser's — the sphere animates
 * only the nodes it has placed (800 of them), and an answer should not be
 * capped by what happens to be drawn. Both halves start from the same question,
 * so the hops you watch and the answer you read are about the same ideas.
 *
 * Grounding is the whole point. The model gets the retrieved nodes, their
 * connections, and the whole-graph type counts, and is told to say plainly when
 * the graph does not hold the answer — a second brain that confabulates is
 * worse than one that admits the gap, because the gap is itself the finding.
 */
export async function answerQuestion(graph: GraphClient, question: string): Promise<AnswerOutcome> {
  const [semantic, text, countsRes] = await Promise.all([
    embed(question)
      .then((embedding) =>
        embedding.length === 0
          ? { results: [] as SemanticHit[] }
          : graph.searchSemantic({ embedding, k: SEMANTIC_K }),
      )
      .catch((err) => {
        log.warn({ err: String(err) }, "semantic retrieval failed");
        return { results: [] as SemanticHit[] };
      }),
    graph
      .searchText({ query: question, k: TEXT_K })
      .catch(() => ({ results: [] as SemanticHit[] })),
    graph.counts().catch(() => ({ counts: {} as Record<string, number> })),
  ]);

  const hits = merge(semantic.results, text.results).slice(0, CONTEXT_NODES);
  if (hits.length === 0) return { ok: false, reason: "no_context", counts: countsRes.counts };

  // Edges for the strongest hits only: one traverse per node, and the tail of
  // the list contributes little beyond its own summary.
  const expanded = await Promise.all(
    hits.slice(0, EXPAND_TOP).map((hit) =>
      graph
        .traverse({ id: str(hit.props.id), depth: 1, limit: EXPAND_LIMIT })
        .then((r) => r.results.map((n) => str(n.props.title)).filter(Boolean))
        .catch(() => [] as string[]),
    ),
  );

  const context: ContextNode[] = hits.map((hit, i) => ({
    id: str(hit.props.id),
    title: str(hit.props.title),
    type: typeOf(hit),
    domain: str(hit.props.domain),
    summary: str(hit.props.summary),
    score: hit.score,
    connections: expanded[i] ?? [],
  }));

  const result = await answerFromGraph(question, context, countsRes.counts);
  if (!result.ok) return { ok: false, reason: result.reason, counts: countsRes.counts };

  // The model cites by id, so anything it invents simply fails to resolve.
  // Deduped because it does cite the same node twice when two sentences lean on
  // it, and the caller renders citations as a source list.
  const byId = new Map(context.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const citations: AnswerCitation[] = [];
  for (const id of result.cited) {
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node) citations.push({ id: node.id, title: node.title, type: node.type });
  }

  log.info({ question, retrieved: context.length, cited: citations.length }, "answered from graph");
  return {
    ok: true,
    answer: result.answer,
    citations,
    inGraph: result.inGraph,
    counts: countsRes.counts,
  };
}
