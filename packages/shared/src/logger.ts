import pino from "pino";

/** Shared structured logger. Pretty in dev (TTY), JSON otherwise. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(process.stdout.isTTY
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
      }
    : {}),
});

export function childLogger(name: string) {
  return logger.child({ service: name });
}
