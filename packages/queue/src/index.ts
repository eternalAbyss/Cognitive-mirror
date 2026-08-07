import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Durable, SQLite-backed job queue (design §12). Ingestion enqueues; the
 * reasoning daemon leases, completes, or fails-with-backoff. Persisting jobs is
 * what makes ingestion survive internet/API outages ("capture everything").
 *
 * Uses Node's built-in `node:sqlite` (no native build step) — important on very
 * recent Node where `better-sqlite3` has no prebuilt binary.
 *
 * Idempotency: `content_hash` is unique, so re-seeing an unchanged artifact
 * (e.g. 5-minute GitHub polling) is a no-op rather than a duplicate enrichment.
 */
export type JobState = "queued" | "leased" | "done" | "failed";

export interface Job {
  id: string;
  type: string;
  payload: unknown;
  contentHash: string;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
}

interface JobRow {
  id: string;
  type: string;
  payload: string;
  content_hash: string;
  state: JobState;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_run_at: number;
  created_at: number;
  updated_at: number;
}

export interface EnqueueResult {
  enqueued: boolean;
  id: string;
  reason?: "duplicate";
}

const BASE_BACKOFF_MS = 5_000;

/**
 * How long a lease is honoured before `reclaimStale` takes the job back.
 * Generous, because a legitimate enrich job can be slow: several Anthropic
 * calls plus embedding every chunk.
 */
const LEASE_TTL_MS = 30 * 60_000;

export class JobQueue {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        content_hash TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        last_error TEXT,
        next_run_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs (state, next_run_at);
    `);
    // Added after the initial schema; ALTER on an existing DB is a no-op error.
    try {
      this.db.exec("ALTER TABLE jobs ADD COLUMN leased_at INTEGER");
    } catch {
      /* column already exists */
    }
    this.reclaimStale();
  }

  /**
   * Return jobs whose lease has expired to the queue.
   *
   * A leased job is only ever un-leased by `complete`/`fail`/`release`, so a
   * worker killed mid-job — which `scripts/down.sh` does on every shutdown —
   * used to strand that job in 'leased' forever: never retried, never surfaced
   * in `failed`, invisible in `stats`. Running this on construction means a
   * daemon restart is enough to recover them.
   *
   * This does not count as an attempt: the job never got a verdict.
   */
  reclaimStale(now = Date.now(), ttlMs = LEASE_TTL_MS): number {
    const info = this.db
      .prepare(
        `UPDATE jobs SET state = 'queued', leased_at = NULL, updated_at = ?
           WHERE state = 'leased' AND COALESCE(leased_at, 0) <= ?`,
      )
      .run(now, now - ttlMs);
    return Number(info.changes);
  }

  /** Insert a job, skipping if its content hash already exists (idempotency). */
  enqueue(args: {
    type: string;
    payload: unknown;
    contentHash: string;
    maxAttempts?: number;
  }): EnqueueResult {
    const now = Date.now();
    const id = randomUUID();
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO jobs
           (id, type, payload, content_hash, state, attempts, max_attempts, next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', 0, ?, 0, ?, ?)`,
      )
      .run(
        id,
        args.type,
        JSON.stringify(args.payload),
        args.contentHash,
        args.maxAttempts ?? 5,
        now,
        now,
      );
    if (info.changes === 0) {
      const existing = this.db
        .prepare(`SELECT id FROM jobs WHERE content_hash = ?`)
        .get(args.contentHash) as { id: string } | undefined;
      return { enqueued: false, id: existing?.id ?? "", reason: "duplicate" };
    }
    return { enqueued: true, id };
  }

  /** Atomically claim the next ready job, or return null. */
  lease(now = Date.now()): Job | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          `SELECT * FROM jobs
             WHERE state = 'queued' AND next_run_at <= ?
             ORDER BY created_at ASC LIMIT 1`,
        )
        .get(now) as JobRow | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return null;
      }
      this.db
        .prepare(`UPDATE jobs SET state = 'leased', leased_at = ?, updated_at = ? WHERE id = ?`)
        .run(now, now, row.id);
      this.db.exec("COMMIT");
      return toJob({ ...row, state: "leased", updated_at: now });
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  complete(id: string): void {
    this.db
      .prepare(`UPDATE jobs SET state = 'done', leased_at = NULL, updated_at = ? WHERE id = ?`)
      .run(Date.now(), id);
  }

  /**
   * Put a leased job back without counting an attempt.
   *
   * For conditions that have nothing to do with the job itself — the budget
   * breaker being open is the motivating case. `fail` would burn one of its
   * five attempts and eventually discard captured content that was never
   * actually processed.
   */
  release(id: string, reason?: string, delayMs = 0): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE jobs SET state = 'queued', leased_at = NULL, last_error = ?, next_run_at = ?, updated_at = ?
           WHERE id = ?`,
      )
      .run(reason ?? null, now + delayMs, now, id);
  }

  /** Record a failure: retry with exponential backoff, or mark failed at the cap. */
  fail(id: string, error: string): void {
    const now = Date.now();
    const row = this.db.prepare(`SELECT attempts, max_attempts FROM jobs WHERE id = ?`).get(id) as
      | { attempts: number; max_attempts: number }
      | undefined;
    if (!row) return;
    const attempts = row.attempts + 1;
    if (attempts >= row.max_attempts) {
      this.db
        .prepare(
          `UPDATE jobs SET state = 'failed', leased_at = NULL, attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
        )
        .run(attempts, error, now, id);
      return;
    }
    const backoff = BASE_BACKOFF_MS * 2 ** (attempts - 1);
    this.db
      .prepare(
        `UPDATE jobs SET state = 'queued', leased_at = NULL, attempts = ?, last_error = ?, next_run_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(attempts, error, now + backoff, now, id);
  }

  stats(): Record<JobState, number> {
    const rows = this.db
      .prepare(`SELECT state, COUNT(*) AS n FROM jobs GROUP BY state`)
      .all() as Array<{ state: JobState; n: number }>;
    const out: Record<JobState, number> = {
      queued: 0,
      leased: 0,
      done: 0,
      failed: 0,
    };
    for (const r of rows) out[r.state] = r.n;
    return out;
  }

  close(): void {
    this.db.close();
  }
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload),
    contentHash: row.content_hash,
    state: row.state,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
