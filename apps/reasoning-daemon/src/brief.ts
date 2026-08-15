import { randomUUID } from "node:crypto";
import { embed } from "@cm/embeddings";
import type { GraphClient } from "@cm/graph-client";
import { type GraphOp, childLogger, loadConfig } from "@cm/shared";
import { synthesizeBrief } from "./anthropic.js";
import { fetchArxiv } from "./sources/arxiv.js";
import { fetchGithubTrending } from "./sources/github-trending.js";
import { fetchRss } from "./sources/rss.js";
import type { BriefCandidate } from "./sources/types.js";

const log = childLogger("daemon:brief");

const MAX_SYNTH_CANDIDATES = 12;

interface Scored {
  cand: BriefCandidate;
  distance: number;
  nearestConcept: string;
}

export interface BriefResult {
  candidates: number;
  kept: number;
  observations: number;
  opLogId?: string;
}

/**
 * Daily world brief (design §12): pull ArXiv + RSS + GitHub-trending, score each
 * against existing Concept/Interest summary vectors, discard the irrelevant, and
 * have the daemon synthesise 3–5 observations into WorldEvent nodes.
 */
export async function runDailyBrief(graph: GraphClient): Promise<BriefResult> {
  const cfg = loadConfig();
  const candidates = (await Promise.all([fetchArxiv(), fetchGithubTrending(), fetchRss()])).flat();
  log.info({ candidates: candidates.length }, "gathered brief candidates");

  const scored: Scored[] = [];
  for (const cand of candidates) {
    let emb: number[];
    try {
      emb = await embed(`${cand.title}\n${cand.text}`);
    } catch {
      continue;
    }
    const best = await nearest(graph, emb);
    // FalkorDB cosine score is a distance (lower = closer); keep the close ones.
    if (best && best.distance <= cfg.BRIEF_THRESHOLD) {
      scored.push({ cand, distance: best.distance, nearestConcept: best.title });
    }
  }
  scored.sort((a, b) => a.distance - b.distance);
  const top = scored.slice(0, MAX_SYNTH_CANDIDATES);
  log.info({ kept: scored.length, toSynth: top.length }, "scored candidates");
  if (top.length === 0) return { candidates: candidates.length, kept: 0, observations: 0 };

  const observations = await synthesizeBrief(
    top.map((s) => ({
      title: s.cand.title,
      text: s.cand.text,
      nearestConcept: s.nearestConcept,
      url: s.cand.url,
    })),
    cfg.BRIEF_MAX_OBSERVATIONS,
  );
  if (observations.length === 0) {
    return { candidates: candidates.length, kept: scored.length, observations: 0 };
  }

  const ops: GraphOp[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const o of observations) {
    const id = randomUUID();
    ops.push({
      kind: "createNode",
      id,
      node: {
        type: "WorldEvent",
        title: o.title,
        summary: o.observation,
        asOf: today,
        metadata: { kind: "world_brief" },
      },
    });
    ops.push({ kind: "setSummaryEmbedding", id, embedding: await embed(o.observation) });
  }
  const res = await graph.execute(ops, `daily brief ${today}`);
  log.info({ observations: observations.length, opLogId: res.opLogId }, "daily brief written");
  return {
    candidates: candidates.length,
    kept: scored.length,
    observations: observations.length,
    opLogId: res.opLogId,
  };
}

/** Nearest existing Concept/Interest node to an embedding (min cosine distance). */
async function nearest(
  graph: GraphClient,
  embedding: number[],
): Promise<{ distance: number; title: string } | null> {
  const hits = [];
  for (const type of ["Concept", "Interest"] as const) {
    try {
      const r = await graph.searchSemantic({ embedding, k: 1, type });
      if (r.results[0]) hits.push(r.results[0]);
    } catch {
      /* ignore */
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.score - b.score);
  const h = hits[0]!;
  // Weight by recent traversal (design §12): a concept read in the last week is
  // "hotter", so shrink its distance to make related world signal more likely to surface.
  const lastReadAt =
    typeof h.props.lastReadAt === "string" ? Date.parse(h.props.lastReadAt) : Number.NaN;
  const recent = Number.isFinite(lastReadAt) && Date.now() - lastReadAt < 7 * 86_400_000;
  const distance = recent ? h.score * 0.85 : h.score;
  return { distance, title: String(h.props.title ?? "") };
}
