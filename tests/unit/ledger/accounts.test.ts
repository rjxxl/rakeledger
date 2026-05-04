import { describe, it, expect } from "vitest";
import { naturalSign, ACCOUNTS, GAME_SCOPED_ACCOUNTS } from "@/lib/ledger/accounts";

describe("account natural sign", () => {
  it("assigns +1 to assets", () => {
    expect(naturalSign("CASH_DRAWER")).toBe(1);
    expect(naturalSign("ZELLE")).toBe(1);
    expect(naturalSign("MARKER_OUTSTANDING")).toBe(1);
  });

  it("assigns -1 to liabilities", () => {
    expect(naturalSign("CHIP_FLOAT")).toBe(-1);
    expect(naturalSign("TIP_POOL")).toBe(-1);
    expect(naturalSign("TOURNAMENT_POOL")).toBe(-1);
  });

  it("assigns -1 to revenue accounts", () => {
    expect(naturalSign("RAKE_POOL")).toBe(-1);
    expect(naturalSign("HOUSE_TAX_POOL")).toBe(-1);
  });

  it("assigns +1 to expense accounts", () => {
    expect(naturalSign("PROMO_POOL")).toBe(1);
  });

  it("assigns +1 to external", () => {
    expect(naturalSign("EXTERNAL")).toBe(1);
  });

  it("includes all 13 accounts in ACCOUNTS list", () => {
    expect(ACCOUNTS.length).toBe(13);
  });

  it("marks game-scoped accounts correctly", () => {
    expect(GAME_SCOPED_ACCOUNTS).toEqual(
      expect.arrayContaining(["RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL"])
    );
    expect(GAME_SCOPED_ACCOUNTS).not.toContain("CASH_DRAWER");
  });
});
