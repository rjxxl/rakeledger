import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { getAccountBalance } from "@/lib/ledger/balance";

describe("getAccountBalance", () => {
  let sessionId: string;
  let gameId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({
      data: { openedById: "test-cashier" },
    });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "Default", rakeSplitConfig: {} },
    });
    gameId = game.id;
  });

  it("returns 0 for an account with no entries", async () => {
    const balance = await getAccountBalance({ account: "CASH_DRAWER", sessionId });
    expect(balance.toString()).toBe("0");
  });

  it("sums positive deltas for an asset account", async () => {
    await testPrisma.transaction.create({
      data: {
        sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
        amount: new Decimal(200), method: "CASH",
        ledgerEntries: { create: [
          { account: "CASH_DRAWER", delta: new Decimal(200) },
          { account: "CHIP_FLOAT", delta: new Decimal(200) },
        ]},
      },
    });
    const balance = await getAccountBalance({ account: "CASH_DRAWER", sessionId });
    expect(balance.toString()).toBe("200");
  });

  it("filters by gameId for game-scoped accounts", async () => {
    const game2 = await testPrisma.game.create({
      data: { sessionId, name: "Hi-Stakes", rakeSplitConfig: {} },
    });
    // Rake on default game
    await testPrisma.transaction.create({
      data: {
        sessionId, gameId, type: "RAKE", createdById: "test-cashier",
        amount: new Decimal(50), method: "CHIPS",
        ledgerEntries: { create: [
          { account: "CHIP_FLOAT", delta: new Decimal(-50) },
          { account: "RAKE_POOL", delta: new Decimal(50), gameId },
        ]},
      },
    });
    // Rake on hi-stakes
    await testPrisma.transaction.create({
      data: {
        sessionId, gameId: game2.id, type: "RAKE", createdById: "test-cashier",
        amount: new Decimal(80), method: "CHIPS",
        ledgerEntries: { create: [
          { account: "CHIP_FLOAT", delta: new Decimal(-80) },
          { account: "RAKE_POOL", delta: new Decimal(80), gameId: game2.id },
        ]},
      },
    });

    const defaultRake = await getAccountBalance({ account: "RAKE_POOL", sessionId, gameId });
    expect(defaultRake.toString()).toBe("50");
    const hiRake = await getAccountBalance({ account: "RAKE_POOL", sessionId, gameId: game2.id });
    expect(hiRake.toString()).toBe("80");
    // Chip float is shared across games — sums across both
    const chipFloat = await getAccountBalance({ account: "CHIP_FLOAT", sessionId });
    expect(chipFloat.toString()).toBe("-130");
  });
});
