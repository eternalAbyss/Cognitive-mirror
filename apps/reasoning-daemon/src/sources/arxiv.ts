import Parser from "rss-parser";
import { loadConfig, childLogger } from "@cm/shared";
import type { BriefCandidate } from "./types.js";

const log = childLogger("daemon:source:arxiv");
const parser = new Parser();

/** Recent papers from the configured ArXiv categories (Atom API). */
export async function fetchArxiv(maxResults = 20): Promise<BriefCandidate[]> {
  const { arxivCategories } = loadConfig();
  if (arxivCategories.length === 0) return [];
  const query = arxivCategories.map((c) => `cat:${c}`).join("+OR+");
  const url = `http://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
  try {
    const feed = await parser.parseURL(url);
    return (feed.items ?? []).map((it) => ({
      kind: "arxiv" as const,
      title: (it.title ?? "").replace(/\s+/g, " ").trim(),
      text: (it.contentSnippet ?? it.content ?? "").replace(/\s+/g, " ").trim(),
      url: it.link,
      source: "arxiv",
      occurredAt: it.isoDate,
    }));
  } catch (err) {
    log.warn({ err: String((err as Error)?.message ?? err) }, "arxiv fetch failed");
    return [];
  }
}
