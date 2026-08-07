import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { packageRoot, resolveHome } from "./home.js";
import { fail, step, warn } from "./ui.js";

/**
 * The data plane (FalkorDB + Ollama) runs in Docker. The compose file ships
 * inside the package, so an installed CLI doesn't need a checkout.
 */
export function composeFile(): string {
  const bundled = join(packageRoot(), "assets", "docker-compose.yml");
  if (existsSync(bundled)) return bundled;
  // Running from a clone (pnpm dev): use the repo's own file.
  const local = join(resolveHome(), "docker-compose.yml");
  if (existsSync(local)) return local;
  fail("could not find docker-compose.yml", "Reinstall the package: npm i -g cognitive-mirror");
}

export function dockerAvailable(): { ok: boolean; reason?: string } {
  const which = spawnSync("docker", ["--version"], { stdio: "ignore" });
  if (which.error) return { ok: false, reason: "not-installed" };
  const info = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (info.status !== 0) return { ok: false, reason: "not-running" };
  return { ok: true };
}

/** Fail with the specific fix rather than hanging in a wait loop. */
export function requireDocker(): void {
  const d = dockerAvailable();
  if (d.ok) return;
  if (d.reason === "not-installed") {
    fail(
      "Docker is not installed",
      "Cognitive-mirror stores its graph in FalkorDB and computes embeddings with\n  Ollama, both of which run as containers.\n\n  Install Docker Desktop: https://docs.docker.com/get-started/get-docker/",
    );
  }
  fail(
    "Docker is installed but not running",
    "Start Docker Desktop (or `sudo systemctl start docker` on Linux), wait for it\n  to report ready, then run this again.",
  );
}

function compose(args: string[], opts: { quiet?: boolean } = {}): number {
  const r = spawnSync("docker", ["compose", "-f", composeFile(), ...args], {
    stdio: opts.quiet ? "ignore" : "inherit",
  });
  return r.status ?? 1;
}

export function composeUp(): void {
  step("starting the data plane (FalkorDB + Ollama)…");
  if (compose(["up", "-d"], { quiet: true }) !== 0) {
    fail("docker compose failed to start the data plane", "Run `docker compose -f " + composeFile() + " up` to see why.");
  }
}

export function composeDown(): void {
  step("stopping the data plane…");
  compose(["down"], { quiet: true });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `check()` succeeds, or give up with an actionable message. */
export async function waitFor(
  label: string,
  check: () => boolean | Promise<boolean>,
  timeoutMs = 120_000,
): Promise<void> {
  step(`waiting for ${label}…`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(1_000);
  }
  fail(
    `${label} did not become ready within ${Math.round(timeoutMs / 1000)}s`,
    `Check the container logs: docker compose -f ${composeFile()} logs`,
  );
}

export function falkorReady(): boolean {
  return spawnSync("docker", ["exec", "cm-falkordb", "redis-cli", "PING"], { stdio: "ignore" }).status === 0;
}

export async function ollamaReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Pull the embedding model on first run. Streams progress; it's a big download. */
export function ensureEmbedModel(model: string): Promise<void> {
  const list = spawnSync("docker", ["exec", "cm-ollama", "ollama", "list"], { encoding: "utf8" });
  if (list.status === 0 && list.stdout.includes(model)) return Promise.resolve();

  step(`pulling the embedding model '${model}' (first run only, ~270 MB)…`);
  return new Promise((resolvePromise) => {
    const child = spawn("docker", ["exec", "cm-ollama", "ollama", "pull", model], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code !== 0) warn(`could not pull '${model}' — embeddings will fail until it is available`);
      resolvePromise();
    });
  });
}
