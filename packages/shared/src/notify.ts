import { loadConfig } from "./config.js";
import { childLogger } from "./logger.js";

const log = childLogger("notify");

export type NotifyPriority = "min" | "low" | "default" | "high" | "urgent";

/**
 * Send a phone notification via Ntfy (design §6/§15: budget breach + service
 * health alerts). No-op when NTFY_TOPIC is unset, so it's safe in dev/tests.
 */
export async function notify(
  title: string,
  message: string,
  priority: NotifyPriority = "default",
  tags: string[] = [],
): Promise<void> {
  const { NTFY_URL, NTFY_TOPIC } = loadConfig();
  if (!NTFY_TOPIC) {
    log.debug({ title }, "ntfy disabled (no NTFY_TOPIC); skipping");
    return;
  }
  try {
    await fetch(`${NTFY_URL.replace(/\/$/, "")}/${NTFY_TOPIC}`, {
      method: "POST",
      headers: {
        Title: title,
        Priority: priority,
        ...(tags.length ? { Tags: tags.join(",") } : {}),
      },
      body: message,
    });
  } catch (err) {
    log.warn({ err: String((err as Error)?.message ?? err) }, "ntfy send failed");
  }
}
