import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { filterTiles, type TileWithBalance } from "@/lib/ledger/tile-filter";

describe("filterTiles", () => {
  const tiles: TileWithBalance[] = [
    { account: "CASH_DRAWER", label: "Cash drawer", balance: new Decimal(0) },
    { account: "ZELLE", label: "Zelle", balance: new Decimal(0) },
    { account: "VENMO", label: "Venmo", balance: new Decimal(50) },
    { account: "CASHAPP", label: "CashApp", balance: new Decimal(0) },
    { account: "MARKER_OUTSTANDING", label: "Markers out", balance: new Decimal(200) },
    { account: "CHIP_FLOAT", label: "Chip float", balance: new Decimal(0) },
    { account: "TIP_POOL", label: "Tip pool", balance: new Decimal(0) },
    { account: "RAKE_POOL", label: "Rake", balance: new Decimal(0) },
    { account: "PROMO_POOL", label: "Promo", balance: new Decimal(0) },
  ];

  it("always shows CASH_DRAWER, CHIP_FLOAT, TIP_POOL, RAKE_POOL even at zero", () => {
    const out = filterTiles(tiles);
    const accounts = out.map((t) => t.account);
    expect(accounts).toContain("CASH_DRAWER");
    expect(accounts).toContain("CHIP_FLOAT");
    expect(accounts).toContain("TIP_POOL");
    expect(accounts).toContain("RAKE_POOL");
  });

  it("hides ZELLE / CASHAPP / PROMO_POOL when zero", () => {
    const out = filterTiles(tiles);
    const accounts = out.map((t) => t.account);
    expect(accounts).not.toContain("ZELLE");
    expect(accounts).not.toContain("CASHAPP");
    expect(accounts).not.toContain("PROMO_POOL");
  });

  it("shows VENMO and MARKER_OUTSTANDING when non-zero", () => {
    const out = filterTiles(tiles);
    const accounts = out.map((t) => t.account);
    expect(accounts).toContain("VENMO");
    expect(accounts).toContain("MARKER_OUTSTANDING");
  });

  it("preserves input order in output", () => {
    const out = filterTiles(tiles);
    expect(out.map((t) => t.account)).toEqual([
      "CASH_DRAWER", "VENMO", "MARKER_OUTSTANDING", "CHIP_FLOAT", "TIP_POOL", "RAKE_POOL",
    ]);
  });
});
