import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where this installation keeps its `.env` and `.data/`.
 *
 * Precedence: an explicit `CM_HOME`, then a checkout you're standing in (so
 * contributors get the behaviour they already have), then `~/.cognitive-mirror`.
 * The result is exported as `CM_HOME` before any service starts, so every child
 * process resolves the same paths regardless of its own cwd.
 */
export function resolveHome(): string {
  const explicit = process.env.CM_HOME;
  if (explicit) return resolve(explicit);

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) && existsSync(join(dir, "apps", "cli"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(homedir(), ".cognitive-mirror");
}

export function envPath(home = resolveHome()): string {
  return join(home, ".env");
}

/** Root of the installed package — where `assets/` and the bundled services live. */
export function packageRoot(): string {
  // dist/cli.js → the package root is one level up.
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/** Parse a `.env` into a map, preserving nothing else. */
export function readEnv(path: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out.set(
      t.slice(0, eq).trim(),
      t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, ""),
    );
  }
  return out;
}

/**
 * Set keys in a `.env`, keeping comments and ordering intact.
 *
 * Rewriting the file wholesale would throw away the explanatory comments in the
 * template, which are most of its value to someone configuring this by hand.
 */
export function updateEnv(path: string, updates: Record<string, string>): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const pending = new Map(Object.entries(updates));

  const rewritten = lines.map((line) => {
    const m = /^(\s*)([A-Z0-9_]+)\s*=/.exec(line);
    if (!m) return line;
    const key = m[2]!;
    if (!pending.has(key)) return line;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${m[1]}${key}=${value}`;
  });

  for (const [key, value] of pending) rewritten.push(`${key}=${value}`);
  writeFileSync(path, `${rewritten.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
}
