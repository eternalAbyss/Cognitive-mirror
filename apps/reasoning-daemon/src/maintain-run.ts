import { childLogger } from "@cm/shared";
import { createGraphClient } from "@cm/graph-client";
import { runMaintenance } from "./maintenance/index.js";

/** On-demand maintenance pass: `pnpm --filter @cm/reasoning-daemon maintain`. */
const log = childLogger("daemon:maintain-run");

const report = await runMaintenance(createGraphClient());
log.info(report, "maintenance complete");
process.exit(0);
