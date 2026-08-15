// Run as a subprocess by stdout-purity.test.ts. Touches everything the stdio
// MCP server touches before it starts speaking protocol: config loading (which
// reads .env through dotenv) and the logger. Anything either of them prints on
// fd 1 shows up as stdout in the parent and fails the test.
//
// Not named *.test.ts on purpose — the vitest include glob would collect it.
import { loadConfig } from "../../src/config.js";
import { childLogger, logger } from "../../src/logger.js";

loadConfig();
logger.info({ probe: "root" }, "root line");
childLogger("probe:child").warn({ probe: "child" }, "child line");

process.stderr.write("fixture-complete\n");
