import { childLogger, loadConfig } from "@cm/shared";

/**
 * One-shot import of your GitHub repositories into the knowledge graph (design §2).
 * For each repo you OWN, it posts the README + description + primary language +
 * topics as a `github_repo` enrich job — so the daemon distils what each project
 * is and the tech behind it into Concepts (and finds cross-repo connections).
 *
 *   pnpm --filter @cm/ingestion repos            # all repos you own
 *   pnpm --filter @cm/ingestion repos --no-archived
 *
 * Needs GITHUB_TOKEN (env or Keychain) and the ingestion service running
 * (`pnpm up`). Idempotent: the webhook hashes (kind, source, text), so re-running
 * skips repos whose README/description haven't changed.
 */
const log = childLogger("ingestion:repos");

const README_MAX_CHARS = 6000; // cap so a giant README doesn't blow up enrichment

interface GhRepo {
  full_name: string;
  name: string;
  description: string | null;
  language: string | null;
  topics?: string[];
  html_url: string;
  archived: boolean;
  fork: boolean;
  pushed_at?: string;
}

function gh(
  path: string,
  token: string,
  accept = "application/vnd.github+json",
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      accept,
      "user-agent": "cognitive-mirror",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

/** All repos owned by the authenticated user, paginated. */
async function listOwnedRepos(token: string): Promise<GhRepo[]> {
  const repos: GhRepo[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await gh(
      `/user/repos?affiliation=owner&sort=pushed&per_page=100&page=${page}`,
      token,
    );
    if (!res.ok) throw new Error(`github /user/repos -> ${res.status}: ${await res.text()}`);
    const batch = (await res.json()) as GhRepo[];
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

/** Raw README text for a repo, or "" if it has none. */
async function fetchReadme(fullName: string, token: string): Promise<string> {
  const res = await gh(`/repos/${fullName}/readme`, token, "application/vnd.github.raw");
  if (res.status === 404) return "";
  if (!res.ok) {
    log.warn({ repo: fullName, status: res.status }, "readme fetch failed");
    return "";
  }
  return (await res.text()).slice(0, README_MAX_CHARS);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not set (env or Keychain)");
  const skipArchived = process.argv.includes("--no-archived");

  let repos = (await listOwnedRepos(cfg.GITHUB_TOKEN)).filter((r) => !r.fork);
  if (skipArchived) repos = repos.filter((r) => !r.archived);
  log.info({ repos: repos.length, skipArchived }, "discovered owned repositories");

  const url = `http://127.0.0.1:${cfg.INGESTION_PORT}/ingest`;
  let added = 0;
  for (const r of repos) {
    const readme = await fetchReadme(r.full_name, cfg.GITHUB_TOKEN);
    const topics = (r.topics ?? []).join(", ");
    const text = [
      r.description ? `Description: ${r.description}` : "",
      r.language ? `Primary language: ${r.language}` : "",
      topics ? `Topics: ${topics}` : "",
      r.archived ? "Status: archived" : "",
      readme ? `\nREADME:\n${readme}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cfg.INGEST_TOKEN ? { authorization: `Bearer ${cfg.INGEST_TOKEN}` } : {}),
        },
        body: JSON.stringify({
          kind: "github_repo",
          title: r.name,
          text: text || r.name,
          source: `github:${r.full_name}`,
          url: r.html_url,
          occurredAt: r.pushed_at,
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { enqueued?: boolean };
        if (j.enqueued) added++;
      } else {
        log.warn(
          { repo: r.full_name, status: res.status },
          "ingest POST failed (is the ingestion service running?)",
        );
      }
    } catch (err) {
      log.warn(
        { repo: r.full_name, err: String((err as Error)?.message ?? err) },
        "ingest POST error",
      );
    }
  }
  log.info(
    { total: repos.length, enqueued: added },
    "repo import done (rest were unchanged duplicates)",
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    log.error({ err: String(err?.message ?? err) }, "repo import failed");
    process.exit(1);
  },
);
