/** Terminal output helpers. Colour only when stdout is a TTY that wants it. */

const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const wrap = (code: string) => (s: string) => (useColor ? `[${code}m${s}[0m` : s);

export const bold = wrap("1");
export const dim = wrap("2");
export const red = wrap("31");
export const green = wrap("32");
export const yellow = wrap("33");
export const cyan = wrap("36");
export const gold = wrap("38;5;178");

export function step(msg: string): void {
  process.stderr.write(`${cyan("▶")} ${msg}\n`);
}

export function ok(msg: string): void {
  process.stderr.write(`${green("✓")} ${msg}\n`);
}

export function warn(msg: string): void {
  process.stderr.write(`${yellow("!")} ${msg}\n`);
}

/** Print an error with an actionable fix, then exit non-zero. */
export function fail(msg: string, fix?: string): never {
  process.stderr.write(`\n${red("✗")} ${bold(msg)}\n`);
  if (fix) process.stderr.write(`\n  ${fix}\n`);
  process.stderr.write("\n");
  process.exit(1);
}

export function heading(msg: string): void {
  process.stderr.write(`\n${bold(msg)}\n`);
}
