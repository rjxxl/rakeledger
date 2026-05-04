import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { getAccountBalance } from "@/lib/ledger/balance";

describe("buy_in transaction shape", () => {
  let sessionId: string;
  let gameId: string;
  let playerId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "Default", rakeSplitConfig: {} },
    });
    gameId = game.id;
    const player = await testPrisma.player.create({ data: { displayName: "Test Player" } });
    playerId = player.id;
  });

  it("cash buy-in increases cash_drawer and chip_float by amount", async () => {
    await createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(500), method: "CASH", playerId,
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(500) },
        { account: "CHIP_FLOAT", delta: new Decimal(500) },
      ],
    });
    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("500");
    expect((await getAccountBalance({ account: "CHIP_FLOAT", sessionId })).toString()).toBe("500");
  });

  it("zelle buy-in increases zelle and chip_float", async () => {
    await createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(300), method: "ZELLE", playerId,
      entries: [
        { account: "ZELLE", delta: new Decimal(300) },
        { account: "CHIP_FLOAT", delta: new Decimal(300) },
      ],
    });
    expect((await getAccountBalance({ account: "ZELLE", sessionId })).toString()).toBe("300");
    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("0");
  });
});
