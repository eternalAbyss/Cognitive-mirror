import { childLogger, loadConfig } from "@cm/shared";
import type { BriefCandidate } from "./types.js";

const log = childLogger("daemon:source:github-trending");

interface GhRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
}

/**
 * "Trending" proxy via the GitHub search API (repos created in the last `days`,
 * by stars) — avoids scraping the trending HTML page, and reuses GITHUB_TOKEN.
 */
export async function fetchGithubTrending(days = 7, count = 15): Promise<BriefCandidate[]> {
  const { GITHUB_TOKEN } = loadConfig();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const url = `https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=${count}`;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "cognitive-mirror",
        ...(GITHUB_TOKEN ? { authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { items?: GhRepo[] };
    return (json.items ?? []).map((r) => ({
      kind: "github_trending" as const,
      title: r.full_name,
      text: `${r.description ?? ""} (${r.language ?? "n/a"}, ★${r.stargazers_count})`.trim(),
      url: r.html_url,
      source: "github_trending",
    }));
  } catch (err) {
    log.warn({ err: String((err as Error)?.message ?? err) }, "github trending fetch failed");
    return [];
  }
}
