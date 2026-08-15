import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { getSecret } from "./keychain.js";

/**
 * The directory that holds this installation's `.env` and `.data/`.
 *
 * Two ways to run, so two ways to find it:
 *
 *  - **Installed** (`npx cognitive-mirror`): `CM_HOME` is set by the CLI and
 *    wins outright. Without it, state would land somewhere arbitrary inside
 *    `node_modules`, because there is no checkout to walk up to.
 *  - **From a clone**: walk up from cwd looking for a `.env`, falling back to
 *    the workspace root. Apps run with their own package dir as cwd, so this is
 *    what makes every service agree on one queue DB.
 *
 * Relative paths in config (the queue DB, budget state) resolve against the
 * result, so all five services point at the same files either way.
 */
export function resolveHomeDir(): string {
  const explicit = process.env.CM_HOME;
  if (explicit) return isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".env"))) return dir;
    // Anchor on the workspace root even if no .env exists.
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Resolve the home dir and load its `.env` into process.env.
 *
 * `quiet` is load-bearing, not cosmetic: from v17 dotenv announces itself on
 * **stdout**, and the stdio MCP server has Claude Desktop reading MCP protocol
 * frames from that exact stream (see `logger.ts`, which pins logging to fd 2
 * for the same reason). One banner there corrupts the session.
 */
function loadEnvFile(): string {
  const dir = resolveHomeDir();
  const candidate = join(dir, ".env");
  if (existsSync(candidate)) loadDotenv({ path: candidate, quiet: true });
  return dir;
}

/**
 * Centralised, zod-validated configuration. Reads from process.env, with
 * secrets (Anthropic key, GitHub token) resolved via the macOS Keychain helper
 * when present, so they need not sit in a plaintext env file.
 */
const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number());

/** Env booleans: "true"/"1"/"yes" (any case) are true; anything else is false. */
const bool = (def: boolean): z.ZodType<boolean, string | undefined> =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v === "" ? def : ["true", "1", "yes"].includes(v.trim().toLowerCase()),
    );

const EnvSchema = z.object({
  // Secrets (may come from Keychain; can be empty in scaffolding/tests).
  ANTHROPIC_API_KEY: z.string().default(""),
  GITHUB_TOKEN: z.string().default(""),

  // GitHub ingestion
  GITHUB_REPOS: z.string().default(""),
  GITHUB_POLL_INTERVAL_MS: num(300_000),

  // FalkorDB
  FALKORDB_HOST: z.string().default("127.0.0.1"),
  FALKORDB_PORT: num(6379),
  FALKORDB_GRAPH: z.string().default("cognitive_mirror"),

  // Ollama embeddings
  OLLAMA_URL: z.string().default("http://127.0.0.1:11434"),
  EMBED_MODEL: z.string().default("nomic-embed-text"),
  EMBED_DIM: num(768),
  CHUNK_TOKENS: num(512),
  CHUNK_OVERLAP: num(64),

  // Service ports (127.0.0.1 only)
  GRAPH_CORE_PORT: num(4001),
  INGESTION_PORT: num(4002),
  MCP_PORT: num(4003),
  DAEMON_PORT: num(4005),

  // Model tiering
  MODEL_ENRICH: z.string().default("claude-haiku-4-5-20251001"),
  MODEL_ADJUDICATE: z.string().default("claude-sonnet-4-6"),
  MODEL_INSIGHT: z.string().default("claude-opus-4-8"),

  // Budget
  DAILY_BUDGET_USD: num(5),
  MONTHLY_BUDGET_USD: num(100),

  // Queue
  QUEUE_DB_PATH: z.string().default("./.data/queue.sqlite"),

  // Budget breaker state (persisted across restarts, design §6)
  BUDGET_STATE_PATH: z.string().default("./.data/budget.json"),

  // Ingestion webhook auth. With no token the webhook is REFUSED, not opened —
  // ALLOW_ANONYMOUS_INGEST=true is the explicit local-dev opt-out.
  INGEST_TOKEN: z.string().default(""),
  ALLOW_ANONYMOUS_INGEST: bool(false),

  // Off-device access. Setting MCP_PUBLIC_URL turns OAuth on and makes it
  // MANDATORY — the MCP server refuses to boot without a passphrase hash,
  // rather than quietly publishing an unauthenticated write API.
  MCP_PUBLIC_URL: z.string().default(""),
  MCP_AUTH_PASSPHRASE_HASH: z.string().default(""),

  // Ntfy health/alert notifications (empty topic = disabled)
  NTFY_URL: z.string().default("https://ntfy.sh"),
  NTFY_TOPIC: z.string().default(""),

  // Daily world brief
  BRIEF_THRESHOLD: num(0.45), // min cosine to a Concept/Interest to keep a candidate
  BRIEF_MAX_OBSERVATIONS: num(5),
  BRIEF_CRON: z.string().default("0 7 * * *"), // 07:00 daily
  ARXIV_CATEGORIES: z.string().default("cs.AI,cs.LG,cs.CL"),
  RSS_FEEDS: z.string().default(""), // comma-separated feed URLs

  // Daemon health probe interval
  HEALTH_INTERVAL_MS: num(120_000),

  // Maintenance engine (design §9). Distance is cosine *distance* (lower = closer),
  // calibrated for nomic-embed-text — NOT the doc's 0.93 similarity figure.
  MAINTENANCE_CRON: z.string().default("30 3 * * *"), // 03:30 nightly
  MERGE_CANDIDATE_DISTANCE: num(0.3),
  MAX_INSIGHTS_PER_RUN: num(3),
  ARCHIVE_INACTIVITY_DAYS: num(30),
  CONCEPT_TARGET_MIN: num(300),
  CONCEPT_TARGET_MAX: num(600),

  // Token prices, as JSON: {"model":{"in":N,"out":N}} in USD per million tokens.
  // Merged over DEFAULT_MODEL_PRICES below, so this only needs the models you
  // changed. See the comment on DEFAULT_MODEL_PRICES for why it isn't empty.
  MODEL_PRICES: z.string().default(""),
});

export interface ModelPrice {
  /** USD per 1M input tokens. */
  in: number;
  /** USD per 1M output tokens. */
  out: number;
}

/**
 * Built-in prices for the models this project ships with, USD per million
 * tokens (Anthropic list prices as of 2026-08).
 *
 * These have defaults on purpose. Prices used to come only from MODEL_PRICES,
 * which was never in this schema and was commented out of `.env.example` — so
 * the table was always empty, every call was costed at $0, and the daily budget
 * breaker could not trip no matter what DAILY_BUDGET_USD said. A safety limit
 * that silently does nothing is worse than no limit, because you stop watching.
 *
 * Prices do drift. `budget.ts` warns once per unpriced model so a model swap
 * can't quietly re-open the same hole.
 */
export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-5": { in: 5, out: 25 },
};

export type AppConfig = z.infer<typeof EnvSchema> & {
  graphCoreUrl: string;
  repoList: string[];
  arxivCategories: string[];
  rssFeeds: string[];
  /** DEFAULT_MODEL_PRICES with any MODEL_PRICES overrides applied. */
  modelPrices: Record<string, ModelPrice>;
};

/** MODEL_PRICES overrides layered onto the built-in table. Bad JSON is ignored. */
function resolveModelPrices(raw: string): Record<string, ModelPrice> {
  if (!raw.trim()) return { ...DEFAULT_MODEL_PRICES };
  try {
    const overrides = JSON.parse(raw) as Record<string, ModelPrice>;
    return { ...DEFAULT_MODEL_PRICES, ...overrides };
  } catch {
    // Can't use the logger here — it imports config, so this would cycle.
    console.warn("[config] MODEL_PRICES is not valid JSON; using built-in prices");
    return { ...DEFAULT_MODEL_PRICES };
  }
}

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;

  const rootDir = loadEnvFile();
  const merged = { ...env };
  // Prefer Keychain for secrets when the env var is absent (no-op on failure).
  merged.ANTHROPIC_API_KEY ||= getSecret("cm-anthropic-api-key") ?? "";
  merged.GITHUB_TOKEN ||= getSecret("cm-github-token") ?? "";

  const parsed = EnvSchema.parse(merged);
  // Anchor file-state paths to the repo root so every service shares one file
  // regardless of its cwd (apps run with their own package dir as cwd).
  parsed.QUEUE_DB_PATH = isAbsolute(parsed.QUEUE_DB_PATH)
    ? parsed.QUEUE_DB_PATH
    : resolve(rootDir, parsed.QUEUE_DB_PATH);
  parsed.BUDGET_STATE_PATH = isAbsolute(parsed.BUDGET_STATE_PATH)
    ? parsed.BUDGET_STATE_PATH
    : resolve(rootDir, parsed.BUDGET_STATE_PATH);
  const csv = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  cached = {
    ...parsed,
    graphCoreUrl: `http://127.0.0.1:${parsed.GRAPH_CORE_PORT}`,
    repoList: csv(parsed.GITHUB_REPOS),
    arxivCategories: csv(parsed.ARXIV_CATEGORIES),
    rssFeeds: csv(parsed.RSS_FEEDS),
    modelPrices: resolveModelPrices(parsed.MODEL_PRICES),
  };
  return cached;
}

/** Test helper to drop the memoised config. */
export function resetConfigCache(): void {
  cached = undefined;
}
