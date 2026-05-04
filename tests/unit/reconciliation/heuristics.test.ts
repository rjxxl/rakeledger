import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  findEqualOpposite, findOutliers, findDecimalTypos, findOrphans,
} from "@/lib/reconciliation/heuristics";

const D = (n: number | string) => new Decimal(n);

describe("findEqualOpposite", () => {
  it("flags two accounts with equal-and-opposite variances", () => {
    const variances = [
      { account: "CASH_DRAWER" as const, variance: D(-220) },
      { account: "ZELLE" as const, variance: D(220) },
    ];
    const txs = [{ id: "t1", amount: D(220), type: "BUY_IN", playerId: "p1", ledgerEntries: [] }];
    const out = findEqualOpposite(variances, txs);
    expect(out).toHaveLength(1);
    expect(out[0].txIds).toContain("t1");
  });

  it("returns nothing when variances don't cancel", () => {
    const variances = [
      { account: "CASH_DRAWER" as const, variance: D(-100) },
      { account: "ZELLE" as const, variance: D(50) },
    ];
    expect(findEqualOpposite(variances, [])).toHaveLength(0);
  });
});

describe("findOutliers", () => {
  it("flags a transaction > 5× the player's median", () => {
    const txs = [
      { id: "t1", amount: D(100), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
      { id: "t2", amount: D(150), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
      { id: "t3", amount: D(200), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
      { id: "t4", amount: D(2750), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
    ];
    const out = findOutliers(txs);
    expect(out.some((s) => s.txIds.includes("t4"))).toBe(true);
  });
});

describe("findDecimalTypos", () => {
  it("flags two amounts where one is 10× the other for same player", () => {
    const txs = [
      { id: "t1", amount: D(275), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
      { id: "t2", amount: D(2750), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
    ];
    const out = findDecimalTypos(txs);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("findOrphans", () => {
  it("returns one suggestion when a player bought in but never cashed out", () => {
    const txs = [
      { id: "t1", amount: D(200), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
    ];
    const out = findOrphans(txs);
    expect(out).toHaveLength(1);
  });

  it("doesn't flag a player who has a chip_walk recorded", () => {
    const txs = [
      { id: "t1", amount: D(200), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
      { id: "t2", amount: D(50), type: "CHIP_WALK", playerId: "p1", ledgerEntries: [] },
    ];
    expect(findOrphans(txs)).toHaveLength(0);
  });
});
