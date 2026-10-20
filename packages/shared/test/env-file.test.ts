import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, resetConfigCache } from "../src/config.js";
import { EnvWriteError, updateEnvFile } from "../src/env-file.js";

let home: string;
let envPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cm-env-"));
  envPath = join(home, ".env");
  process.env.CM_HOME = home;
  resetConfigCache();
});

afterEach(() => {
  delete process.env.CM_HOME;
  rmSync(home, { recursive: true, force: true });
  resetConfigCache();
});

const read = () => readFileSync(envPath, "utf8");

describe("updateEnvFile", () => {
  it("rewrites a value in place, keeping comments and order", () => {
    writeFileSync(
      envPath,
      [
        "# ── Ollama ──",
        "OLLAMA_URL=http://127.0.0.1:11434",
        "EMBED_MODEL=nomic-embed-text",
        "",
      ].join("\n"),
    );
    updateEnvFile({ EMBED_MODEL: "mxbai-embed-large" });
    expect(read()).toBe(
      [
        "# ── Ollama ──",
        "OLLAMA_URL=http://127.0.0.1:11434",
        "EMBED_MODEL=mxbai-embed-large",
        "",
      ].join("\n"),
    );
  });

  it("appends keys the file does not have yet", () => {
    writeFileSync(envPath, "OLLAMA_URL=http://127.0.0.1:11434\n");
    updateEnvFile({ NTFY_TOPIC: "my-topic" });
    const out = read();
    expect(out).toContain("OLLAMA_URL=http://127.0.0.1:11434");
    expect(out).toContain("NTFY_TOPIC=my-topic");
  });

  it("creates the file when there isn't one", () => {
    updateEnvFile({ DAILY_BUDGET_USD: "9" });
    expect(read()).toContain("DAILY_BUDGET_USD=9");
  });

  it("handles `export ` prefixes and surrounding whitespace", () => {
    writeFileSync(envPath, "  export DAILY_BUDGET_USD=5\n");
    updateEnvFile({ DAILY_BUDGET_USD: "12" });
    expect(read()).toBe("DAILY_BUDGET_USD=12\n");
  });

  it("quotes values that would otherwise change the file's meaning", () => {
    updateEnvFile({ GITHUB_REPOS: "a/b # not a comment" });
    expect(read()).toContain('GITHUB_REPOS="a/b # not a comment"');
    resetConfigCache();
    expect(loadConfig().GITHUB_REPOS).toBe("a/b # not a comment");
  });

  it("refuses a key that would smuggle in a second assignment", () => {
    expect(() => updateEnvFile({ "A\nB": "x" })).toThrow(EnvWriteError);
    expect(() => updateEnvFile({ lowercase: "x" })).toThrow(EnvWriteError);
  });

  it("refuses a value containing a line break", () => {
    expect(() => updateEnvFile({ NTFY_TOPIC: "a\nDAILY_BUDGET_USD=0" })).toThrow(EnvWriteError);
  });

  it("refuses settings that cannot change under a running process", () => {
    expect(() => updateEnvFile({ GRAPH_CORE_PORT: "9999" })).toThrow(EnvWriteError);
    expect(() => updateEnvFile({ EMBED_DIM: "1024" })).toThrow(EnvWriteError);
  });

  it("leaves the file untouched when any key in the patch is rejected", () => {
    writeFileSync(envPath, "DAILY_BUDGET_USD=5\n");
    expect(() => updateEnvFile({ DAILY_BUDGET_USD: "7", MCP_PORT: "1" })).toThrow(EnvWriteError);
    expect(read()).toBe("DAILY_BUDGET_USD=5\n");
  });
});

describe("loadConfig hot reload", () => {
  it("picks up a change to .env without a restart", async () => {
    writeFileSync(envPath, "DAILY_BUDGET_USD=5\n");
    expect(loadConfig().DAILY_BUDGET_USD).toBe(5);

    // The cache is keyed on mtime+size and rate-limited; wait past both.
    await new Promise((r) => setTimeout(r, 300));
    updateEnvFile({ DAILY_BUDGET_USD: "42" });
    expect(loadConfig().DAILY_BUDGET_USD).toBe(42);
  });

  it("applies a file value for a var the environment does not set", () => {
    writeFileSync(envPath, "NTFY_TOPIC=from-file\n");
    expect(loadConfig().NTFY_TOPIC).toBe("from-file");
  });

  it("does NOT let a file edit override a var exported in the shell", async () => {
    // Precedence is decided by a snapshot taken when config.ts is first imported,
    // so this has to set the var and then load the module fresh. Worth the
    // ceremony: a dashboard edit silently overriding a shell-exported secret
    // would be a real hazard, not a cosmetic one.
    process.env.NTFY_TOPIC = "from-shell";
    writeFileSync(envPath, "NTFY_TOPIC=from-file\n");
    try {
      vi.resetModules();
      const fresh = await import("../src/config.js");
      expect(fresh.loadConfig().NTFY_TOPIC).toBe("from-shell");
    } finally {
      delete process.env.NTFY_TOPIC;
      vi.resetModules();
    }
  });
});
