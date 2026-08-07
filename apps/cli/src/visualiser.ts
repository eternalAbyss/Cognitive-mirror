import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./home.js";
import { dim, warn } from "./ui.js";

export const VISUALISER_PORT = 4004;

/**
 * Next's standalone build: a self-contained server.js plus its static assets.
 *
 * The path keeps the monorepo shape the standalone output was traced with —
 * server.js resolves `next` through `../../node_modules`, so it cannot be moved
 * up a level.
 */
function serverPath(): string {
  return join(packageRoot(), "dist", "visualiser", "apps", "visualiser", "server.js");
}

export function visualiserAvailable(): boolean {
  return existsSync(serverPath());
}

/**
 * Start the Next.js UI.
 *
 * Bound to 127.0.0.1, not 0.0.0.0. The visualiser proxies unauthenticated
 * writes — deleting nodes, resolving approvals, triggering billable research —
 * to the backend services, so it must never be reachable from the network.
 */
export function startVisualiser(home: string): ChildProcess | null {
  if (!visualiserAvailable()) {
    warn("visualiser bundle not found — the backend will run without the UI");
    return null;
  }
  const child = spawn(process.execPath, [serverPath()], {
    env: {
      ...process.env,
      CM_HOME: home,
      PORT: String(VISUALISER_PORT),
      HOSTNAME: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const label = dim("[ui]");
  const relay = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) process.stderr.write(`${label} ${line}\n`);
    }
  };
  child.stdout?.on("data", relay);
  child.stderr?.on("data", relay);
  return child;
}
