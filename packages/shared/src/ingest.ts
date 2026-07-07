import { z } from "zod";

/**
 * Payload for an `enrich` job: a unit of captured content that the reasoning
 * daemon turns into graph nodes (design §12). Kept source-agnostic so all four
 * ingestion quadrants (GitHub now; notes, conversations, world events later)
 * share one enrichment path.
 */
export const ENRICH_KINDS = [
  "github_commit",
  "github_repo",
  "note",
  "journal",
  "youtube",
  "kindle_highlight",
  "arxiv",
  "rss",
  "github_trending",
  "research",
  "generic",
] as const;

export const EnrichPayloadSchema = z.object({
  kind: z.enum(ENRICH_KINDS).default("generic"),
  title: z.string(),
  text: z.string(),
  /** Provenance, e.g. "github:owner/repo". */
  source: z.string(),
  url: z.string().optional(),
  occurredAt: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  meta: z.record(z.unknown()).optional(),
});
export type EnrichPayload = z.infer<typeof EnrichPayloadSchema>;

export const JOB_TYPE_ENRICH = "enrich" as const;
export const JOB_TYPE_WORLD_BRIEF = "world_brief" as const;
export const JOB_TYPE_MAINTENANCE = "maintenance" as const;
