import { loadConfig, childLogger, notify } from "@cm/shared";

const log = childLogger("daemon:health");

/**
 * Periodic service-health probe (design §15 Phase-2 exit): pings graph-core and
 * Ollama; sends an Ntfy alert on a transition into an unhealthy state (edge-
 * triggered, so it doesn't spam while something stays down).
 */
export function startHealthProbe(): () => void {
  const cfg = loadConfig();
  const down = new Set<string>();

  const check = async (name: string, url: string) => {
    let ok = false;
    try {
      ok = (await fetch(url)).ok;
    } catch {
      ok = false;
    }
    if (!ok && !down.has(name)) {
      down.add(name);
      log.warn({ name }, "service down");
      void notify("Service down", `${name} is unreachable`, "urgent", ["rotating_light"]);
    } else if (ok && down.has(name)) {
      down.delete(name);
      log.info({ name }, "service recovered");
      void notify("Service recovered", `${name} is back`, "default", ["white_check_mark"]);
    }
  };

  const tick = () => {
    void check("graph-core", `${cfg.graphCoreUrl}/health`);
    void check("ollama", `${cfg.OLLAMA_URL}/api/tags`);
  };
  tick();
  const timer = setInterval(tick, cfg.HEALTH_INTERVAL_MS);
  log.info({ everyMs: cfg.HEALTH_INTERVAL_MS }, "health probe started");
  return () => clearInterval(timer);
}
