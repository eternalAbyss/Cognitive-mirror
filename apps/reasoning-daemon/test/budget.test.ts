import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Budget, BudgetExceededError } from "../src/budget.js";

const dirs: string[] = [];
function tmpStatePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "cm-budget-"));
  dirs.push(dir);
  return join(dir, "budget.json");
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const prices = { "test-model": { in: 1, out: 1 } }; // $1 / 1M tokens each

describe("Budget persistence", () => {
  it("persists spend across restarts (same day)", () => {
    const statePath = tmpStatePath();
    const a = new Budget({ statePath, prices, dailyCap: 100, monthlyCap: 1000 });
    a.record("test-model", { input: 2_000_000, output: 0 }); // $2

    // A fresh instance (a "restart") must see the persisted spend.
    const b = new Budget({ statePath, prices, dailyCap: 100, monthlyCap: 1000 });
    expect(b.snapshot().spendUsd).toBeCloseTo(2, 6);
    expect(b.snapshot().monthSpendUsd).toBeCloseTo(2, 6);
  });

  it("trips the daily breaker once the cap is reached", () => {
    const statePath = tmpStatePath();
    const b = new Budget({ statePath, prices, dailyCap: 5, monthlyCap: 1000 });
    b.record("test-model", { input: 5_000_000, output: 0 }); // $5 == cap
    expect(() => b.check()).toThrow(BudgetExceededError);
  });

  it("trips the monthly breaker independently of the daily one", () => {
    const statePath = tmpStatePath();
    const b = new Budget({ statePath, prices, dailyCap: 1000, monthlyCap: 5 });
    b.record("test-model", { input: 6_000_000, output: 0 }); // $6 > monthly cap
    expect(() => b.check()).toThrow(/monthly budget/);
  });

  it("resets the daily counter when the persisted day is stale", () => {
    const statePath = tmpStatePath();
    // Yesterday's spend, same month.
    writeFileSync(
      statePath,
      JSON.stringify({ day: "2000-01-01", month: "2000-01", spendUsd: 99, monthSpendUsd: 99 }),
    );
    const b = new Budget({ statePath, prices, dailyCap: 100, monthlyCap: 1000 });
    expect(b.snapshot().spendUsd).toBe(0); // rolled over
    expect(b.snapshot().monthSpendUsd).toBe(0);
  });

  it("starts fresh when the state file is missing or corrupt", () => {
    const statePath = tmpStatePath();
    writeFileSync(statePath, "{ not json");
    const b = new Budget({ statePath, prices, dailyCap: 100, monthlyCap: 1000 });
    expect(b.snapshot().spendUsd).toBe(0);
  });
});
