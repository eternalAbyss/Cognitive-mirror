import { JobQueue } from "@cm/queue";
import { resetConfigCache } from "@cm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIngestServer } from "../src/server.js";

/**
 * The /ingest webhook is the one unauthenticated-by-default write surface this
 * project used to ship: `if (!expected) return true` meant an install that never
 * set INGEST_TOKEN accepted anything. These tests pin the fail-closed default.
 */

const BODY = { kind: "note", title: "t", text: "some captured text" };

function post(app: ReturnType<typeof buildIngestServer>, headers: Record<string, string> = {}) {
  return app.request("/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(BODY),
  });
}

let queue: JobQueue;

beforeEach(() => {
  queue = new JobQueue(":memory:");
  // Set rather than delete: loadConfig re-reads the repo .env, and dotenv only
  // fills keys that are absent — so a deleted key would be repopulated from the
  // developer's own .env and make these results machine-dependent.
  process.env.INGEST_TOKEN = "";
  process.env.ALLOW_ANONYMOUS_INGEST = "";
  resetConfigCache();
});

afterEach(() => {
  queue.close();
  // Set rather than delete: loadConfig re-reads the repo .env, and dotenv only
  // fills keys that are absent — so a deleted key would be repopulated from the
  // developer's own .env and make these results machine-dependent.
  process.env.INGEST_TOKEN = "";
  process.env.ALLOW_ANONYMOUS_INGEST = "";
  resetConfigCache();
});

describe("ingest webhook auth", () => {
  it("rejects an unauthenticated post when no token is configured", async () => {
    const res = await post(buildIngestServer(queue));
    expect(res.status).toBe(401);
    expect(queue.stats().queued).toBe(0);
  });

  it("allows anonymous posts only with the explicit opt-out", async () => {
    process.env.ALLOW_ANONYMOUS_INGEST = "true";
    resetConfigCache();
    const res = await post(buildIngestServer(queue));
    expect(res.status).toBe(200);
    expect(queue.stats().queued).toBe(1);
  });

  it("accepts a correct bearer token", async () => {
    process.env.INGEST_TOKEN = "s3cret";
    resetConfigCache();
    const res = await post(buildIngestServer(queue), { authorization: "Bearer s3cret" });
    expect(res.status).toBe(200);
  });

  it("rejects a wrong token, and one of a different length", async () => {
    process.env.INGEST_TOKEN = "s3cret";
    resetConfigCache();
    const app = buildIngestServer(queue);
    expect((await post(app, { authorization: "Bearer wrong!" })).status).toBe(401);
    expect((await post(app, { authorization: "Bearer short" })).status).toBe(401);
    expect((await post(app, { authorization: "s3cret" })).status).toBe(401);
  });

  it("ignores a token passed in the query string", async () => {
    // Query strings land in access logs, browser history, and Referer headers,
    // so the ?token= fallback was removed rather than kept as a convenience.
    process.env.INGEST_TOKEN = "s3cret";
    resetConfigCache();
    const res = await buildIngestServer(queue).request("/ingest?token=s3cret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BODY),
    });
    expect(res.status).toBe(401);
  });

  it("leaves /health open", async () => {
    const res = await buildIngestServer(queue).request("/health");
    expect(res.status).toBe(200);
  });
});
