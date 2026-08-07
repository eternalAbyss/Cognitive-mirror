import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./home.js";
import { dim, fail, gold } from "./ui.js";

export interface ServiceSpec {
  name: string;
  /** Bundle under `dist/services/`, or the source path when run from a clone. */
  entry: string;
  port: number;
  what: string;
}

export const SERVICES: ServiceSpec[] = [
  { name: "graph", entry: "graph-core", port: 4001, what: "graph service (sole FalkorDB writer)" },
  { name: "ingest", entry: "ingestion", port: 4002, what: "ingestion queue + webhook" },
  { name: "mcp", entry: "mcp-server", port: 4003, what: "MCP tools over HTTP" },
  { name: "daemon", entry: "reasoning-daemon", port: 4005, what: "autonomous reasoning" },
];

/** Absolute path to a bundled service entrypoint. */
export function servicePath(entry: string): string {
  const p = join(packageRoot(), "dist", "services", `${entry}.js`);
  if (!existsSync(p)) {
    fail(`missing bundled service '${entry}'`, "The package looks incomplete — reinstall it.");
  }
  return p;
}

export interface Supervisor {
  stop: () => void;
  /** Resolves when every child has exited. */
  done: Promise<void>;
}

/**
 * Start every service as a child process and keep them alive together.
 *
 * Deliberately all-or-nothing: if one dies the rest are torn down, because a
 * half-running stack fails in ways that look like data problems (the visualiser
 * renders an empty graph; MCP tools time out) rather than like a crash.
 */
export function startAll(home: string, extra: ServiceSpec[] = []): Supervisor {
  const children: ChildProcess[] = [];
  let stopping = false;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const c of children) c.kill("SIGTERM");
  };

  const exits: Array<Promise<void>> = [];

  for (const svc of [...SERVICES, ...extra]) {
    const child = spawn(process.execPath, [servicePath(svc.entry)], {
      env: { ...process.env, CM_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);

    const label = dim(`[${svc.name}]`);
    const relay = (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) process.stderr.write(`${label} ${line}\n`);
      }
    };
    child.stdout?.on("data", relay);
    child.stderr?.on("data", relay);

    exits.push(
      new Promise<void>((res) => {
        child.on("exit", (code, signal) => {
          if (!stopping && code !== 0) {
            process.stderr.write(`${label} exited (${signal ?? code}); shutting down the rest\n`);
            stop();
          }
          res();
        });
      }),
    );
  }

  return { stop, done: Promise.all(exits).then(() => undefined) };
}

export function printReady(): void {
  process.stderr.write(
    `\n  ${gold("●")} Cognitive-mirror is running\n\n` +
      `    Visualiser   http://127.0.0.1:4004\n` +
      SERVICES.map((s) => `    ${s.name.padEnd(12)} :${s.port}  ${dim(s.what)}`).join("\n") +
      `\n\n  ${dim("Ctrl-C stops the services. The data plane keeps running — `cognitive-mirror down` stops that too.")}\n\n`,
  );
}
