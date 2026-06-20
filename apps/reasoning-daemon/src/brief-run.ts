import { childLogger } from "@cm/shared";
import { createGraphClient } from "@cm/graph-client";
import { runDailyBrief } from "./brief.js";

/** On-demand daily brief for testing: `pnpm --filter @cm/reasoning-daemon brief`. */
const log = childLogger("daemon:brief-run");

const result = await runDailyBrief(createGraphClient());
log.info(result, "brief complete");
process.exit(0);
