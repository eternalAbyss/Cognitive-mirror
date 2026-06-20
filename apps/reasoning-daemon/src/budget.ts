import { loadConfig, childLogger } from "@cm/shared";

const log = childLogger("daemon:budget");

/** Raised when the daily budget cap is hit — the circuit breaker (design §6). */
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

/**
 * Budget counter + circuit breaker (design §6). Prices are NOT hardcoded — they
 * come from the MODEL_PRICES env (JSON: {"model":{"in":N,"out":N}} USD per Mtok).
 * If a model's price is absent, cost is counted as 0 (tokens are still tracked),
 * so the breaker simply won't trip until prices are configured.
 *
 * State is in-memory with a UTC-day rollover — adequate for Phase 1; persist to
 * disk in a later pass if cross-restart accuracy is needed.
 */
class Budget {
  private day = utcDay();
  private spendUsd = 0;
  private readonly prices: Record<string, ModelPrice>;
  private readonly dailyCap: number;

  constructor() {
    const cfg = loadConfig();
    this.dailyCap = cfg.DAILY_BUDGET_USD;
    this.prices = parsePrices(process.env.MODEL_PRICES);
  }

  private rollover(): void {
    const today = utcDay();
    if (today !== this.day) {
      this.day = today;
      this.spendUsd = 0;
      log.info("daily budget reset");
    }
  }

  /** Throw if the cap is already reached. Call before a non-essential API call. */
  check(): void {
    this.rollover();
    if (this.dailyCap > 0 && this.spendUsd >= this.dailyCap) {
      throw new BudgetExceededError(
        `daily budget $${this.dailyCap} reached (spent $${this.spendUsd.toFixed(4)})`,
      );
    }
  }

  record(model: string, usage: { input: number; output: number }): void {
    this.rollover();
    const p = this.prices[model];
    if (p) {
      this.spendUsd += (usage.input / 1e6) * p.in + (usage.output / 1e6) * p.out;
    }
    log.debug(
      { model, ...usage, spendUsd: Number(this.spendUsd.toFixed(4)) },
      "api usage recorded",
    );
  }

  snapshot(): { day: string; spendUsd: number; dailyCap: number } {
    this.rollover();
    return { day: this.day, spendUsd: this.spendUsd, dailyCap: this.dailyCap };
  }
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
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

export const budget = new Budget();
