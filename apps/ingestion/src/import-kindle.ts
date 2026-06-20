import { readFileSync } from "node:fs";
import { loadConfig, childLogger } from "@cm/shared";
import { parseClippings } from "./kindle-parse.js";

/**
 * Import Kindle highlights from a "My Clippings.txt" file and POST each as a
 * `kindle_highlight` enrich job (design §2). Idempotent — the webhook hashes
 * (kind, source, text), so re-running skips unchanged highlights.
 *
 *   pnpm --filter @cm/ingestion kindle ["/path/to/My Clippings.txt"]
 */
const log = childLogger("ingestion:kindle");

async function main(): Promise<void> {
  const cfg = loadConfig();
  const path = process.argv[2] ?? "./My Clippings.txt";
  const clips = parseClippings(readFileSync(path, "utf8"));
  log.info({ path, clips: clips.length }, "parsed clippings");

  const url = `http://127.0.0.1:${cfg.INGESTION_PORT}/ingest`;
  let added = 0;
  for (const c of clips) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.INGEST_TOKEN ? { authorization: `Bearer ${cfg.INGEST_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        kind: "kindle_highlight",
        title: `${c.book} — highlight`,
        text: c.text,
        source: `kindle:${c.book}`,
      }),
    });
    if (res.ok) {
      const r = (await res.json()) as { enqueued?: boolean };
      if (r.enqueued) added++;
    } else {
      log.warn({ status: res.status }, "ingest POST failed");
    }
  }
  log.info({ total: clips.length, added }, "kindle import done (rest were duplicates)");
}

main().then(
  () => process.exit(0),
  (err) => {
    log.error({ err: String(err?.message ?? err) }, "kindle import failed");
    process.exit(1);
  },
);
