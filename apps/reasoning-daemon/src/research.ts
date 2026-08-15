import type { GraphClient } from "@cm/graph-client";
import { type EnrichPayload, childLogger } from "@cm/shared";
import { researchWithWebSearch } from "./anthropic.js";
import { enrichJob } from "./enrich.js";

const log = childLogger("daemon:research");

export interface ResearchOutcome {
  ok: boolean;
  reason?: string;
  topic: string;
  summary?: string;
  citations?: Array<{ title: string; url: string }>;
  sourceId?: string;
  conceptsAdded?: number;
  conceptTitles?: string[];
}

/**
 * Research a topic on the live web and write the findings into the graph as
 * notes. The web-search synthesis flows through the SAME enrichment pipeline as
 * every other source, so it produces a Source node + extracted Concept nodes +
 * embeddings — with the citation URLs preserved on the Source.
 */
export async function researchTopic(graph: GraphClient, topic: string): Promise<ResearchOutcome> {
  log.info({ topic }, "researching topic");
  const { text, citations } = await researchWithWebSearch(topic);
  if (!text) return { ok: false, reason: "no_results", topic };

  const payload: EnrichPayload = {
    kind: "research",
    title: topic,
    text,
    source: "research:web",
    url: citations[0]?.url,
    meta: { citations },
  };
  const outcome = await enrichJob(graph, payload);
  log.info(
    {
      topic,
      sourceId: outcome.sourceId,
      concepts: outcome.conceptIds.length,
      citations: citations.length,
    },
    "research notes written",
  );

  return {
    ok: true,
    topic,
    summary: text,
    citations,
    sourceId: outcome.sourceId,
    conceptsAdded: outcome.conceptIds.length,
    conceptTitles: outcome.conceptTitles,
  };
}
