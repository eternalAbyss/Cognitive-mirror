import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, childLogger } from "@cm/shared";

const log = childLogger("daemon:budget");

/** Raised when a budget cap is hit — the circuit breaker (design §6). */
export class BudgetExceededError extends Error {
  readonly retriable = true;
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

interface ModelPrice {
  in: number; // USD per 1M input tokens
  out: number; // USD per 1M output tokens
}

interface BudgetState {
  day: string; // UTC day, YYYY-MM-DD
  month: string; // UTC month, YYYY-MM
  spendUsd: number; // spend so far today
  monthSpendUsd: number; // spend so far this month
}

interface BudgetOptions {
  statePath?: string;
  prices?: Record<string, ModelPrice>;
  dailyCap?: number;
  monthlyCap?: number;
}

/**
 * Budget counter + circuit breaker (design §6). Prices are NOT hardcoded — they
 * come from the MODEL_PRICES env (JSON: {"model":{"in":N,"out":N}} USD per Mtok).
 * If a model's price is absent, cost is counted as 0 (tokens are still tracked),
 * so the breaker simply won't trip until prices are configured.
 *
 * State is write-through persisted to BUDGET_STATE_PATH so spend survives daemon
 * restarts (the breaker can't be reset just by bouncing the process). Day/month
 * rollovers zero the relevant counter. Only the daemon writes this file, so a
 * plain atomic file write (tmp + rename) is sufficient — no locking needed.
 */
class Budget {
  private state: BudgetState;
  private readonly statePath: string;
  private readonly prices: Record<string, ModelPrice>;
  private readonly dailyCap: number;
  private readonly monthlyCap: number;

  constructor(opts: BudgetOptions = {}) {
    const cfg = loadConfig();
    this.statePath = opts.statePath ?? cfg.BUDGET_STATE_PATH;
    this.dailyCap = opts.dailyCap ?? cfg.DAILY_BUDGET_USD;
    this.monthlyCap = opts.monthlyCap ?? cfg.MONTHLY_BUDGET_USD;
    this.prices = opts.prices ?? parsePrices(process.env.MODEL_PRICES);
    this.state = this.load();
    this.rollover(); // a stale persisted day/month is zeroed on boot
  }

  /** Load persisted state, falling back to a fresh zeroed state. */
  private load(): BudgetState {
    try {
      const raw = JSON.parse(readFileSync(this.statePath, "utf8")) as Partial<BudgetState>;
      if (typeof raw.day === "string" && typeof raw.spendUsd === "number") {
        return {
          day: raw.day,
          month: typeof raw.month === "string" ? raw.month : raw.day.slice(0, 7),
          spendUsd: raw.spendUsd,
          monthSpendUsd: typeof raw.monthSpendUsd === "number" ? raw.monthSpendUsd : raw.spendUsd,
        };
      }
    } catch {
      /* no/!corrupt state file — start fresh */
    }
    return { day: utcDay(), month: utcMonth(), spendUsd: 0, monthSpendUsd: 0 };
  }

  /** Atomically persist state (tmp file + rename) so a crash can't truncate it. */
  private persist(): void {
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      const tmp = `${this.statePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state));
      renameSync(tmp, this.statePath);
    } catch (err) {
      log.warn({ err: String((err as Error)?.message ?? err) }, "could not persist budget state");
    }
  }

  private rollover(): void {
    const today = utcDay();
    const month = utcMonth();
    let changed = false;
    if (today !== this.state.day) {
      this.state.day = today;
      this.state.spendUsd = 0;
      changed = true;
      log.info("daily budget reset");
    }
    if (month !== this.state.month) {
      this.state.month = month;
      this.state.monthSpendUsd = 0;
      changed = true;
      log.info("monthly budget reset");
    }
    if (changed) this.persist();
  }

  /** Throw if a cap is already reached. Call before a non-essential API call. */
  check(): void {
    this.rollover();
    if (this.dailyCap > 0 && this.state.spendUsd >= this.dailyCap) {
      throw new BudgetExceededError(
        `daily budget $${this.dailyCap} reached (spent $${this.state.spendUsd.toFixed(4)})`,
      );
    }
    if (this.monthlyCap > 0 && this.state.monthSpendUsd >= this.monthlyCap) {
      throw new BudgetExceededError(
        `monthly budget $${this.monthlyCap} reached (spent $${this.state.monthSpendUsd.toFixed(4)})`,
      );
    }
  }

  record(model: string, usage: { input: number; output: number }): void {
    this.rollover();
    const p = this.prices[model];
    if (p) {
      const cost = (usage.input / 1e6) * p.in + (usage.output / 1e6) * p.out;
      this.state.spendUsd += cost;
      this.state.monthSpendUsd += cost;
      this.persist();
    }
    log.debug(
      { model, ...usage, spendUsd: Number(this.state.spendUsd.toFixed(4)) },
      "api usage recorded",
    );
  }

  snapshot(): { day: string; spendUsd: number; dailyCap: number; monthSpendUsd: number; monthlyCap: number } {
    this.rollover();
    return {
      day: this.state.day,
      spendUsd: this.state.spendUsd,
      dailyCap: this.dailyCap,
      monthSpendUsd: this.state.monthSpendUsd,
      monthlyCap: this.monthlyCap,
    };
  }
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function parsePrices(raw: string | undefined): Record<string, ModelPrice> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, ModelPrice>;
  } catch {
    log.warn("MODEL_PRICES is not valid JSON; ignoring");
    return {};
  }
}

export { Budget };
export const budget = new Budget();
