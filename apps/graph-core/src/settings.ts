import { EnvWriteError, loadConfig, updateEnvFile } from "@cm/shared";
import { SECRET_KEYS, SETTING_GROUPS, WRITABLE_KEYS } from "./settings-schema.js";

/**
 * Runtime settings, read from and written to the installation's `.env`.
 *
 * This lives in graph-core rather than the visualiser for the same reason every
 * other backend capability does: the Next app is a client of localhost services,
 * not a second place where business logic lives. (It also sidesteps bundling
 * `@cm/shared`, whose `.js`-suffixed ESM source Turbopack won't resolve.)
 *
 * Secret VALUES never leave this process. The dashboard is told whether a secret
 * is set, never what it is, so a screenshot or a cached response can't leak the
 * Anthropic key.
 */
export function readSettings(): {
  groups: typeof SETTING_GROUPS;
  values: Record<string, string | boolean>;
} {
  const cfg = loadConfig() as unknown as Record<string, unknown>;
  const values: Record<string, string | boolean> = {};
  for (const key of WRITABLE_KEYS) {
    const raw = cfg[key];
    if (SECRET_KEYS.has(key)) {
      // Presence only. "" means genuinely unset; the sentinel means "set, withheld".
      values[key] = typeof raw === "string" && raw.length > 0 ? SECRET_SET : "";
      continue;
    }
    values[key] = typeof raw === "boolean" ? raw : raw == null ? "" : String(raw);
  }
  return { groups: SETTING_GROUPS, values };
}

/** Stand-in sent to the client for a secret that is set. Never a real value. */
export const SECRET_SET = "__set__";

export interface WriteResult {
  ok: boolean;
  changed?: string[];
  error?: string;
}

/**
 * Apply a patch to `.env`. Every service re-reads the file on its next config
 * access, so anything marked `live` in the schema takes effect without a restart.
 */
export function writeSettings(body: unknown): WriteResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "expected a JSON object" };
  }
  const patch: Record<string, string> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!WRITABLE_KEYS.has(key)) return { ok: false, error: `unknown setting: ${key}` };
    // A secret comes back as the sentinel when the user didn't retype it. Leave
    // it alone: the UI never held the real value, so writing this through would
    // overwrite a working key with a placeholder.
    if (value === null || value === SECRET_SET) continue;
    if (typeof value === "boolean") {
      patch[key] = value ? "true" : "false";
      continue;
    }
    if (typeof value !== "string" && typeof value !== "number") {
      return { ok: false, error: `${key} must be text` };
    }
    patch[key] = String(value);
  }
  if (Object.keys(patch).length === 0) return { ok: true, changed: [] };
  try {
    updateEnvFile(patch);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof EnvWriteError ? err.message : "could not write .env",
    };
  }
  return { ok: true, changed: Object.keys(patch) };
}
