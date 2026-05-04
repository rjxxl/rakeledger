import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { getBalanceAt } from "@/lib/ledger/time-travel";

describe("getBalanceAt", () => {
  let sessionId: string;
  let gameId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "Default", rakeSplitConfig: {} },
    });
    gameId = game.id;
  });

  it("returns the balance at a specific point in time", async () => {
    // Three sequential buy-ins at controlled times
    const tx1 = await createTransaction({
      sessionId, gameId, type: "BUY_IN",
      createdById: "test-cashier", amount: new Decimal(100), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(100) },
        { account: "CHIP_FLOAT", delta: new Decimal(100) },
      ],
    });
    const tx2 = await createTransaction({
      sessionId, gameId, type: "BUY_IN",
      createdById: "test-cashier", amount: new Decimal(200), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(200) },
        { account: "CHIP_FLOAT", delta: new Decimal(200) },
      ],
    });
    const tx3 = await createTransaction({
      sessionId, gameId, type: "BUY_IN",
      createdById: "test-cashier", amount: new Decimal(300), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(300) },
        { account: "CHIP_FLOAT", delta: new Decimal(300) },
      ],
    });

    // Balance at the moment of tx2 (inclusive) should be 100 + 200 = 300
    const balance = await getBalanceAt({ account: "CASH_DRAWER", sessionId, asOf: tx2.createdAt });
    expect(balance.toString()).toBe("300");

    // Balance after tx3 = 600
    const balanceAfter = await getBalanceAt({ account: "CASH_DRAWER", sessionId, asOf: tx3.createdAt });
    expect(balanceAfter.toString()).toBe("600");
  });
});
