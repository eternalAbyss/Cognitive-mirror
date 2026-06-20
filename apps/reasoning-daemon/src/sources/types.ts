import type { EnrichPayload } from "@cm/shared";

/** One outbound-world item considered for the daily brief (design §12). */
export interface BriefCandidate {
  kind: EnrichPayload["kind"];
  title: string;
  text: string;
  url?: string;
  source: string;
  occurredAt?: string;
}
