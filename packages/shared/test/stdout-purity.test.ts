import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The stdio MCP server hands Claude Desktop protocol frames on stdout, so
 * nothing else in the process may write there. Two dependency upgrades have
 * already threatened this: pino defaults to stdout unless pinned to fd 2, and
 * dotenv from v17 announces itself on stdout unless passed `quiet`.
 *
 * Both were caught by hand. This catches the next one.
 *
 * It runs in a subprocess because the guarantee is about the real file
 * descriptor — pino writes through sonic-boom straight to the fd, so stubbing
 * `process.stdout.write` in-process would prove nothing.
 */
const fixture = fileURLToPath(new URL("./fixtures/stdout-purity.fixture.ts", import.meta.url));

describe("stdout purity", () => {
  it("keeps stdout empty while loading config and logging", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", fixture], {
      encoding: "utf8",
      // A .env beside the fixture would change what dotenv prints; run from the
      // package root so the resolution is the same one the services get.
      cwd: fileURLToPath(new URL("..", import.meta.url)),
    });

    expect(r.error).toBeUndefined();
    expect(r.stderr).toContain("fixture-complete");
    expect(r.status).toBe(0);

    // The assertion. Any byte here is a byte in the MCP protocol stream.
    expect(r.stdout).toBe("");
  });
});
