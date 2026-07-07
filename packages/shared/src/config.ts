import { existsSync } from "node:fs";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { getSecret } from "./keychain.js";

/**
 * Load the nearest .env walking up from cwd (apps run with their own package dir
 * as cwd) and return the directory it was found in — the repo root. Relative
 * paths in config (e.g. the queue DB) are resolved against this so every service
 * points at the SAME file regardless of its cwd.
 */
function loadEnvFile(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return dir;
    }
    // Anchor on the workspace root even if no .env exists.
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  return process.cwd();
}

/**
 * Centralised, zod-validated configuration. Reads from process.env, with
 * secrets (Anthropic key, GitHub token) resolved via the Keychain helper so the
 * Mac Mini deployment can keep them out of plaintext env files (design §4).
 */
const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number());

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

  // Ingestion webhook auth (empty = allow, for local dev)
  INGEST_TOKEN: z.string().default(""),

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
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  graphCoreUrl: string;
  repoList: string[];
  arxivCategories: string[];
  rssFeeds: string[];
};

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
  };
  return cached;
}

/** Test helper to drop the memoised config. */
export function resetConfigCache(): void {
  cached = undefined;
}
