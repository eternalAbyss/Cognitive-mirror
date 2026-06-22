import pino from "pino";

/**
 * Shared structured logger. Pretty in dev (TTY), JSON otherwise — and ALWAYS
 * writes to stderr (fd 2). This matters for the stdio MCP server: Claude Desktop
 * launches it as a subprocess and reads MCP protocol frames from stdout, so any
 * log on stdout would corrupt the stream. stderr is captured by Desktop's logs.
 */
const level = process.env.LOG_LEVEL ?? "info";

export const logger = process.stdout.isTTY
  ? pino({
      level,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", destination: 2 },
      },
    })
  : pino({ level }, pino.destination(2));

export function childLogger(name: string) {
  return logger.child({ service: name });
}
