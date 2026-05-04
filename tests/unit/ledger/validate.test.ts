import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { validateBalanced, BalanceError } from "@/lib/ledger/validate";

const D = (n: string | number) => new Decimal(n);

describe("validateBalanced", () => {
  it("accepts a valid 2-leg buy_in (cash + chip_float)", () => {
    expect(() =>
      validateBalanced([
        { account: "CASH_DRAWER", delta: D(200) },
        { account: "CHIP_FLOAT", delta: D(200) },
      ])
    ).not.toThrow();
  });

  it("accepts a valid 2-leg cash_out (both decrease)", () => {
    expect(() =>
      validateBalanced([
        { account: "CASH_DRAWER", delta: D(-150) },
        { account: "CHIP_FLOAT", delta: D(-150) },
      ])
    ).not.toThrow();
  });

  it("accepts a valid 2-leg rake (chip_float ↓, rake_pool ↑)", () => {
    expect(() =>
      validateBalanced([
        { account: "CHIP_FLOAT", delta: D(-50) },
        { account: "RAKE_POOL", delta: D(50) },
      ])
    ).not.toThrow();
  });

  it("accepts a valid 2-leg tip_payout (both decrease — settle liability with asset)", () => {
    expect(() =>
      validateBalanced([
        { account: "CASH_DRAWER", delta: D(-70) },
        { account: "TIP_POOL", delta: D(-70) },
      ])
    ).not.toThrow();
  });

  it("accepts a valid freeroll_prize_payout (chip_float ↑, promo_pool ↑)", () => {
    expect(() =>
      validateBalanced([
        { account: "CHIP_FLOAT", delta: D(225) },
        { account: "PROMO_POOL", delta: D(225) },
      ])
    ).not.toThrow();
  });

  it("rejects an unbalanced transaction", () => {
    expect(() =>
      validateBalanced([
        { account: "CASH_DRAWER", delta: D(200) },
        { account: "CHIP_FLOAT", delta: D(100) },
      ])
    ).toThrow(BalanceError);
  });

  it("rejects a single-entry transaction", () => {
    expect(() =>
      validateBalanced([{ account: "CASH_DRAWER", delta: D(100) }])
    ).toThrow(/at least 2 entries/);
  });

  it("accepts a 3-leg balanced transaction", () => {
    expect(() =>
      validateBalanced([
        { account: "TIP_POOL", delta: D(-87) },     // settle full tip pool slice
        { account: "CASH_DRAWER", delta: D(-70) },  // pay $70 cash
        { account: "HOUSE_TAX_POOL", delta: D(17) }, // $17 to house
      ])
    ).not.toThrow();
  });
});
