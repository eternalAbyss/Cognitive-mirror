import { describe, it, expect } from "vitest";
import { JobQueue } from "../src/index.js";

function freshQueue(): JobQueue {
  return new JobQueue(":memory:");
}

describe("JobQueue", () => {
  it("enqueues and leases a job", () => {
    const q = freshQueue();
    const r = q.enqueue({ type: "enrich", payload: { a: 1 }, contentHash: "h1" });
    expect(r.enqueued).toBe(true);

    const job = q.lease();
    expect(job?.type).toBe("enrich");
    expect(job?.payload).toEqual({ a: 1 });
    expect(q.lease()).toBeNull(); // nothing left ready
    q.close();
  });

  it("dedupes by content hash (idempotency)", () => {
    const q = freshQueue();
    const a = q.enqueue({ type: "enrich", payload: {}, contentHash: "dup" });
    const b = q.enqueue({ type: "enrich", payload: {}, contentHash: "dup" });
    expect(a.enqueued).toBe(true);
    expect(b.enqueued).toBe(false);
    expect(b.reason).toBe("duplicate");
    expect(q.stats().queued).toBe(1);
    q.close();
  });

  it("completes a job", () => {
    const q = freshQueue();
    q.enqueue({ type: "enrich", payload: {}, contentHash: "h" });
    const job = q.lease()!;
    q.complete(job.id);
    expect(q.stats().done).toBe(1);
    expect(q.stats().queued).toBe(0);
    q.close();
  });

  it("retries with backoff then fails at the cap", () => {
    const q = freshQueue();
    q.enqueue({ type: "enrich", payload: {}, contentHash: "h", maxAttempts: 2 });

    const j1 = q.lease()!;
    q.fail(j1.id, "boom");
    // backed off into the future → not immediately leasable
    expect(q.lease()).toBeNull();
    // but leasable once its backoff window has passed
    const j2 = q.lease(Date.now() + 60_000);
    expect(j2?.id).toBe(j1.id);

    q.fail(j2!.id, "boom again"); // 2nd attempt hits the cap
    expect(q.stats().failed).toBe(1);
    q.close();
  });
});
