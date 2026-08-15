#!/usr/bin/env node
import * as cmd from "./commands.js";
import { fail } from "./ui.js";

/**
 * `cognitive-mirror` — the single entrypoint for running the whole stack.
 *
 * Hand-rolled dispatch rather than a parser dependency: the surface is a dozen
 * verbs with almost no flags, and the published package is better off with zero
 * runtime dependencies.
 */
async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      return cmd.help();

    case "version":
    case "-v":
    case "--version":
      return cmd.version();

    case "init":
      return cmd.init();
    case "doctor":
      return cmd.doctor();
    case "up":
      return cmd.up();
    case "down":
      return cmd.down();
    case "status":
      return cmd.status();
    case "seed":
      return cmd.seed();
    case "reset":
      return cmd.reset(rest.includes("--force") || rest.includes("-f"));
    case "mcp":
      return cmd.mcpStdio();
    case "tunnel":
      return cmd.tunnel();

    case "import": {
      const [what, ...args] = rest;
      if (what === "kindle") return cmd.importKindle(args[0]);
      if (what === "repos") return cmd.importRepos();
      return fail(
        `unknown import source: ${what ?? "(none)"}`,
        "Available: `import kindle <file>`, `import repos`",
      );
    }

    case "auth": {
      if (rest[0] === "set-passphrase") return cmd.setPassphrase();
      return fail(
        `unknown auth subcommand: ${rest[0] ?? "(none)"}`,
        "Available: `auth set-passphrase`",
      );
    }

    default:
      return fail(
        `unknown command: ${command}`,
        "Run `cognitive-mirror help` to see what's available.",
      );
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  fail(String((err as Error)?.message ?? err));
});
