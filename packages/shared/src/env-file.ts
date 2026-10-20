import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveHomeDir } from "./config.js";

/** Absolute path of the installation's `.env`, whether or not it exists yet. */
export function envFilePath(): string {
  return join(resolveHomeDir(), ".env");
}

/**
 * Keys this process will accept for a write. Deliberately strict: the value
 * ends up in a file that every service sources, so a key like `FOO\nBAR=x`
 * would smuggle in a second assignment.
 */
const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Settings that cannot be changed from under a running process, and that the
 * writer therefore refuses. Ports are already bound, the embedding dimension is
 * baked into the vector index, and the MCP auth material is read once at boot
 * precisely so it can't be swapped at runtime. Editing these is a job for the
 * file plus a restart, and silently accepting them would be worse than saying no.
 */
export const IMMUTABLE_KEYS = new Set([
  "GRAPH_CORE_PORT",
  "INGESTION_PORT",
  "MCP_PORT",
  "DAEMON_PORT",
  "EMBED_DIM",
  "MCP_PUBLIC_URL",
  "MCP_AUTH_PASSPHRASE_HASH",
  "QUEUE_DB_PATH",
  "BUDGET_STATE_PATH",
  "CM_HOME",
]);

/**
 * A value needs quoting when it has leading/trailing space, or contains a
 * character dotenv would otherwise treat as structure.
 */
function serialise(value: string): string {
  if (value === "") return "";
  const needsQuotes = /[\s#"'`$\\]/.test(value) || value !== value.trim();
  if (!needsQuotes) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/** Does this line assign `key`? Tolerates `export ` and leading whitespace. */
function assigns(line: string, key: string): boolean {
  const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
  return m?.[1] === key;
}

export class EnvWriteError extends Error {}

/**
 * Apply `patch` to the `.env` in place.
 *
 * Rewrites the value of each key where it already appears and appends the rest
 * under a marked section, so the file keeps its comments, its grouping and its
 * order. That matters more than it sounds: `.env.example` documents every
 * setting with the reasoning behind it, people copy it to `.env`, and a writer
 * that re-serialised the file from a parsed map would throw all of that away
 * the first time anything was changed from the UI.
 *
 * The write is atomic (temp file + rename) because five services read this file
 * and a torn write would take all of them down at once.
 */
export function updateEnvFile(patch: Record<string, string>): void {
  const entries = Object.entries(patch);
  for (const [key, value] of entries) {
    if (!KEY_RE.test(key)) throw new EnvWriteError(`invalid setting name: ${key}`);
    if (IMMUTABLE_KEYS.has(key)) throw new EnvWriteError(`${key} cannot be changed at runtime`);
    if (typeof value !== "string") throw new EnvWriteError(`${key} must be a string`);
    if (value.includes("\n") || value.includes("\r"))
      throw new EnvWriteError(`${key} must not contain a line break`);
  }
  if (entries.length === 0) return;

  const path = envFilePath();
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  const hadTrailingNewline = original === "" || original.endsWith("\n");
  const lines = original === "" ? [] : original.replace(/\n$/, "").split("\n");

  const remaining = new Map(entries);
  const next = lines.map((line) => {
    for (const [key, value] of remaining) {
      if (assigns(line, key)) {
        remaining.delete(key);
        return `${key}=${serialise(value)}`;
      }
    }
    return line;
  });

  if (remaining.size > 0) {
    if (next.length > 0 && next[next.length - 1] !== "") next.push("");
    next.push("# ── Added from the dashboard ───────────────────────────────────────────────");
    for (const [key, value] of remaining) next.push(`${key}=${serialise(value)}`);
  }

  const body = next.join("\n") + (hadTrailingNewline ? "\n" : "");
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, path);
}
