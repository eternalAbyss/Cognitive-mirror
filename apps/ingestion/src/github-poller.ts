import type { JobQueue } from "@cm/queue";
import { childLogger, type EnrichPayload, JOB_TYPE_ENRICH, loadConfig } from "@cm/shared";

const log = childLogger("ingestion:github");

interface GhCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author?: { date?: string; name?: string } };
}

async function fetchCommits(repo: string, token: string): Promise<GhCommit[]> {
  const res = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=10`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "cognitive-mirror",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`github ${repo} -> ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as GhCommit[];
}

/** Poll configured repos once; enqueue an enrich job per commit (sha = idempotency key). */
export async function pollOnce(queue: JobQueue): Promise<void> {
  const cfg = loadConfig();
  if (cfg.repoList.length === 0) {
    log.debug("no GITHUB_REPOS configured; skipping poll");
    return;
  }
  for (const repo of cfg.repoList) {
    try {
      const commits = await fetchCommits(repo, cfg.GITHUB_TOKEN);
      let added = 0;
      for (const c of commits) {
        const message = c.commit.message ?? "";
        const payload: EnrichPayload = {
          kind: "github_commit",
          title: message.split("\n")[0]?.slice(0, 200) || c.sha.slice(0, 8),
          text: message,
          source: `github:${repo}`,
          url: c.html_url,
          occurredAt: c.commit.author?.date,
          meta: { sha: c.sha, author: c.commit.author?.name },
        };
        // sha is immutable → perfect content hash for a commit.
        const r = queue.enqueue({
          type: JOB_TYPE_ENRICH,
          payload,
          contentHash: `github_commit:${c.sha}`,
        });
        if (r.enqueued) added++;
      }
      log.info({ repo, seen: commits.length, added }, "polled repo");
    } catch (err) {
      log.warn({ repo, err: String((err as Error)?.message ?? err) }, "poll failed");
    }
  }
}

/** Start the recurring poll loop. Returns a stop function. */
export function startPolling(queue: JobQueue): () => void {
  const cfg = loadConfig();
  void pollOnce(queue);
  const timer = setInterval(() => void pollOnce(queue), cfg.GITHUB_POLL_INTERVAL_MS);
  return () => clearInterval(timer);
}
