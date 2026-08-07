import { childLogger, loadConfig } from "@cm/shared";
import Parser from "rss-parser";
import type { BriefCandidate } from "./types.js";

const log = childLogger("daemon:source:rss");
const parser = new Parser();

/** Latest entries from each configured RSS/Atom feed (newsletters, blogs). */
export async function fetchRss(perFeed = 5): Promise<BriefCandidate[]> {
  const { rssFeeds } = loadConfig();
  const out: BriefCandidate[] = [];
  for (const url of rssFeeds) {
    try {
      const feed = await parser.parseURL(url);
      const name = feed.title ?? url;
      for (const it of (feed.items ?? []).slice(0, perFeed)) {
        out.push({
          kind: "rss",
          title: (it.title ?? "").trim(),
          text: (it.contentSnippet ?? it.content ?? "").replace(/\s+/g, " ").trim(),
          url: it.link,
          source: `rss:${name}`,
          occurredAt: it.isoDate,
        });
      }
    } catch (err) {
      log.warn({ url, err: String((err as Error)?.message ?? err) }, "rss fetch failed");
    }
  }
  return out;
}
