import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import { join } from "node:path";
import { ENV_TEMPLATE } from "./env-template.js";
import {
  composeDown,
  composeFile,
  composeUp,
  dockerAvailable,
  ensureEmbedModel,
  falkorReady,
  ollamaReady,
  requireDocker,
  waitFor,
} from "./docker.js";
import { envPath, readEnv, resolveHome, updateEnv } from "./home.js";
import { SERVICES, servicePath, startAll, printReady } from "./services.js";
import { VISUALISER_PORT, startVisualiser } from "./visualiser.js";
import { bold, cyan, dim, fail, gold, green, heading, ok, red, step, warn, yellow } from "./ui.js";

const OLLAMA_DEFAULT = "http://127.0.0.1:11434";

function envValue(home: string, key: string, fallback: string): string {
  return readEnv(envPath(home)).get(key) || fallback;
}

// ── init ─────────────────────────────────────────────────────────────────────

export async function init(): Promise<void> {
  const home = resolveHome();
  const path = envPath(home);
  mkdirSync(home, { recursive: true });

  heading("Cognitive-mirror setup");
  process.stderr.write(`${dim(`Configuration and data live in ${home}`)}\n\n`);

  if (existsSync(path)) {
    ok(`.env already exists — keeping it (edit ${path} to change anything)`);
  } else {
    writeFileSync(path, ENV_TEMPLATE, { mode: 0o600 });
    ok(`wrote ${path}`);
  }

  const existing = readEnv(path);
  const hasKey = Boolean(existing.get("ANTHROPIC_API_KEY"));

  if (!hasKey && process.stdin.isTTY) {
    process.stderr.write(
      `\n  An Anthropic API key powers enrichment, the daily brief, nightly\n` +
        `  maintenance, and web research. Ingestion and the graph work without one.\n` +
        `  ${dim("Get one at https://console.anthropic.com/settings/keys")}\n\n`,
    );
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const key = (await rl.question("  Anthropic API key (Enter to skip): ")).trim();
    rl.close();
    if (key) {
      updateEnv(path, { ANTHROPIC_API_KEY: key });
      ok("saved");
    } else {
      warn(`skipped — add ANTHROPIC_API_KEY to ${path} when you have one`);
    }
  } else if (!hasKey) {
    warn(`no ANTHROPIC_API_KEY set — add one to ${path}`);
  }

  // A local install with no ingest token would otherwise 401 its own Shortcut
  // and browser extension on first use, which reads as a broken install.
  if (!existing.get("INGEST_TOKEN")) {
    const token = randomBytes(32).toString("hex");
    updateEnv(path, { INGEST_TOKEN: token });
    ok("generated an ingest token (see INGEST_TOKEN in .env)");
  }

  heading("Next");
  process.stderr.write(`  ${cyan("cognitive-mirror up")}   ${dim("start everything")}\n\n`);
}

// ── doctor ───────────────────────────────────────────────────────────────────

export async function doctor(): Promise<void> {
  const home = resolveHome();
  heading("Cognitive-mirror doctor");

  let problems = 0;
  const check = (label: string, good: boolean, detail: string) => {
    process.stderr.write(`  ${good ? green("✓") : red("✗")} ${label.padEnd(22)} ${dim(detail)}\n`);
    if (!good) problems += 1;
  };

  const [major] = process.versions.node.split(".").map(Number);
  check("node >= 22", (major ?? 0) >= 22, `v${process.versions.node}`);

  const d = dockerAvailable();
  check(
    "docker",
    d.ok,
    d.ok ? "running" : d.reason === "not-installed" ? "not installed" : "installed but not running",
  );

  check("home directory", existsSync(home), home);
  const hasEnv = existsSync(envPath(home));
  check(".env", hasEnv, hasEnv ? envPath(home) : "missing — run `cognitive-mirror init`");

  if (hasEnv) {
    const env = readEnv(envPath(home));
    const key = env.get("ANTHROPIC_API_KEY");
    check("anthropic key", Boolean(key), key ? "set" : "missing — reasoning features will fail");
    const token = env.get("INGEST_TOKEN");
    const anon = env.get("ALLOW_ANONYMOUS_INGEST") === "true";
    check(
      "ingest auth",
      Boolean(token) || anon,
      token ? "token set" : anon ? "ANONYMOUS (local dev only)" : "no token — /ingest returns 401",
    );
    if (env.get("MCP_PUBLIC_URL") && !env.get("MCP_AUTH_PASSPHRASE_HASH")) {
      check("mcp oauth", false, "MCP_PUBLIC_URL set without a passphrase — the server will refuse to start");
    }
  }

  if (d.ok) {
    check("falkordb", falkorReady(), falkorReady() ? "responding on :6379" : "not running — `cognitive-mirror up`");
    const url = envValue(home, "OLLAMA_URL", OLLAMA_DEFAULT);
    const oll = await ollamaReady(url);
    check("ollama", oll, oll ? `responding on ${url}` : "not running — `cognitive-mirror up`");
  }

  process.stderr.write(
    problems === 0
      ? `\n  ${green("Everything looks good.")}\n\n`
      : `\n  ${yellow(`${problems} thing${problems === 1 ? "" : "s"} to fix.`)}\n\n`,
  );
  if (problems > 0) process.exitCode = 1;
}

// ── up ───────────────────────────────────────────────────────────────────────

export async function up(): Promise<void> {
  const home = resolveHome();
  requireDocker();

  if (!existsSync(envPath(home))) {
    fail("not configured yet", "Run `cognitive-mirror init` first.");
  }

  composeUp();
  await waitFor("FalkorDB", falkorReady);
  const ollamaUrl = envValue(home, "OLLAMA_URL", OLLAMA_DEFAULT);
  await waitFor("Ollama", () => ollamaReady(ollamaUrl));
  await ensureEmbedModel(envValue(home, "EMBED_MODEL", "nomic-embed-text"));

  step("starting services…");
  const supervisor = startAll(home);
  const ui = startVisualiser(home);

  const shutdown = () => {
    process.stderr.write("\n");
    step("shutting down…");
    ui?.kill("SIGTERM");
    supervisor.stop();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Give the services a moment to bind before advertising their ports.
  setTimeout(printReady, 2_500).unref();

  await supervisor.done;
  ui?.kill("SIGTERM");
}

// ── down ─────────────────────────────────────────────────────────────────────

export function down(): void {
  for (const port of [...SERVICES.map((s) => s.port), VISUALISER_PORT]) {
    // Port-based rather than pattern-based: `pkill -f` on a command line is
    // fragile and can match unrelated processes on a shared machine.
    const r = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    for (const pid of (r.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  ok("services stopped");
  if (dockerAvailable().ok) composeDown();
  ok("data plane stopped (your graph is preserved)");
}

// ── status ───────────────────────────────────────────────────────────────────

export async function status(): Promise<void> {
  heading("Cognitive-mirror status");
  const home = resolveHome();
  process.stderr.write(`  ${dim(home)}\n\n`);

  for (const svc of SERVICES) {
    let state = red("down");
    try {
      const res = await fetch(`http://127.0.0.1:${svc.port}/health`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (res.ok) state = green("up");
    } catch {
      /* down */
    }
    process.stderr.write(`  ${svc.name.padEnd(10)} :${svc.port}  ${state}  ${dim(svc.what)}\n`);
  }

  let ui = red("down");
  try {
    const res = await fetch(`http://127.0.0.1:${VISUALISER_PORT}`, { signal: AbortSignal.timeout(1_500) });
    if (res.ok) ui = green("up");
  } catch {
    /* down */
  }
  process.stderr.write(`  ${"ui".padEnd(10)} :${VISUALISER_PORT}  ${ui}  ${dim("visualiser")}\n`);

  const d = dockerAvailable();
  process.stderr.write(
    `\n  ${"falkordb".padEnd(10)} :6379  ${d.ok && falkorReady() ? green("up") : red("down")}  ${dim("graph + vectors")}\n`,
  );
  const oll = await ollamaReady(envValue(home, "OLLAMA_URL", OLLAMA_DEFAULT));
  process.stderr.write(`  ${"ollama".padEnd(10)} :11434 ${oll ? green("up") : red("down")}  ${dim("embeddings")}\n\n`);
}

// ── reset ────────────────────────────────────────────────────────────────────

export async function reset(force: boolean): Promise<void> {
  const home = resolveHome();
  if (!force) {
    if (!process.stdin.isTTY) {
      fail("reset is destructive", "Re-run with --force to confirm in a non-interactive shell.");
    }
    process.stderr.write(
      `\n  ${bold("This deletes your entire knowledge graph")} — every node, edge,\n` +
        `  queued job, and the budget breaker's recorded spend.\n\n` +
        `  ${dim(home)}\n\n`,
    );
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = (await rl.question(`  Type ${bold("reset")} to confirm: `)).trim();
    rl.close();
    if (answer !== "reset") {
      process.stderr.write("\n  Cancelled.\n\n");
      return;
    }
  }

  requireDocker();
  if (!falkorReady()) {
    composeUp();
    await waitFor("FalkorDB", falkorReady);
  }
  runService("graph-core-reset", home);
  for (const f of ["queue.sqlite", "queue.sqlite-shm", "queue.sqlite-wal", "budget.json"]) {
    rmSync(join(home, ".data", f), { force: true });
  }
  ok("graph, queue, and budget cleared");
}

// ── auth ─────────────────────────────────────────────────────────────────────

/**
 * Store a scrypt hash of the OAuth login passphrase.
 *
 * The plaintext is never written anywhere: `.env` holds only
 * `scrypt$<salt>$<hash>`, so a leaked config file doesn't hand over the
 * passphrase itself.
 */
export async function setPassphrase(): Promise<void> {
  const home = resolveHome();
  const path = envPath(home);
  if (!existsSync(path)) fail("not configured yet", "Run `cognitive-mirror init` first.");
  if (!process.stdin.isTTY) {
    fail("a passphrase must be entered interactively", "Run this from a terminal.");
  }

  heading("Set the MCP login passphrase");
  process.stderr.write(
    `${dim("  This is what you type when authorising a remote Claude client.\n" +
      "  Choose something long; it is the only thing between the internet and your graph.")}\n\n`,
  );

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const first = await rl.question("  Passphrase: ");
  const second = await rl.question("  Confirm:    ");
  rl.close();

  if (first !== second) fail("the two entries did not match");
  if (first.length < 12) fail("passphrase is too short", "Use at least 12 characters.");

  const salt = randomBytes(16);
  const hash = scryptSync(first, salt, 64);
  updateEnv(path, {
    MCP_AUTH_PASSPHRASE_HASH: `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`,
  });
  ok("passphrase set");
  process.stderr.write(
    `\n  ${dim("Restart the stack for it to take effect: cognitive-mirror down && cognitive-mirror up")}\n\n`,
  );
}

// ── one-shot service runners ─────────────────────────────────────────────────

/** Run a bundled entrypoint to completion in the foreground. */
export function runService(entry: string, home: string, args: string[] = []): void {
  const r = spawnSync(process.execPath, [servicePath(entry), ...args], {
    stdio: "inherit",
    env: { ...process.env, CM_HOME: home },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

export function seed(): void {
  runService("seed", resolveHome());
}

export function importKindle(path?: string): void {
  if (!path) {
    fail(
      "no file given",
      "Point it at your Kindle clippings file:\n" +
        "    cognitive-mirror import kindle '/Volumes/Kindle/documents/My Clippings.txt'",
    );
  }
  runService("import-kindle", resolveHome(), [path]);
}

export function importRepos(): void {
  runService("import-repos", resolveHome());
}

/** stdio MCP server — what Claude Desktop launches. Must not write to stdout. */
export function mcpStdio(): void {
  runService("mcp-stdio", resolveHome());
}

export function tunnel(): void {
  const home = resolveHome();
  const url = readEnv(envPath(home)).get("MCP_PUBLIC_URL");
  if (!url) {
    fail(
      "MCP_PUBLIC_URL is not set",
      "Off-device access needs a hostname you control. See the setup guide:\n" +
        "    https://github.com/eternalAbyss/Cognitive-mirror/blob/main/apps/tunnel/README.md",
    );
  }
  if (!readEnv(envPath(home)).get("MCP_AUTH_PASSPHRASE_HASH")) {
    fail(
      "refusing to expose an unauthenticated MCP server",
      "Run `cognitive-mirror auth set-passphrase` first.",
    );
  }
  const which = spawnSync("cloudflared", ["--version"], { stdio: "ignore" });
  if (which.error) {
    fail("cloudflared is not installed", "macOS: brew install cloudflared\n  Other: https://github.com/cloudflare/cloudflared/releases");
  }
  const host = new URL(url).hostname;
  step(`tunnelling ${host} → http://127.0.0.1:4003`);
  spawnSync("cloudflared", ["tunnel", "run", "--url", "http://127.0.0.1:4003", "cognitive-mirror"], {
    stdio: "inherit",
  });
}

// ── help ─────────────────────────────────────────────────────────────────────

export function help(): void {
  process.stderr.write(`
  ${gold("cognitive-mirror")} — a local-first second brain

  ${bold("Setup")}
    init                    Create the config directory and .env
    doctor                  Check prerequisites and report what's missing

  ${bold("Run")}
    up                      Start the data plane and all services
    down                    Stop everything (your graph is preserved)
    status                  Show what's running

  ${bold("Data")}
    seed                    Load a few example nodes
    import kindle <file>    Import Kindle highlights ("My Clippings.txt")
    import repos            Import your GitHub repositories
    reset [--force]         Delete the entire graph and start over

  ${bold("Clients")}
    mcp                     Run the stdio MCP server (for Claude Desktop)
    auth set-passphrase     Set the login passphrase for remote access
    tunnel                  Expose the MCP server via Cloudflare

  ${dim(`Config: ${envPath()}`)}
  ${dim(`Compose file: ${existsSync(composeFile()) ? composeFile() : "bundled"}`)}

  ${dim("Docs: https://github.com/eternalAbyss/Cognitive-mirror")}

`);
}

export function version(): void {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    process.stdout.write(`${pkg.version}\n`);
  } catch {
    process.stdout.write("unknown\n");
  }
}
