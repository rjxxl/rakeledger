import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";

describe("closed session is frozen", () => {
  let sessionId: string;
  let gameId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({
      data: {
        openedById: "test-cashier",
        status: "CLOSED",
        closedAt: new Date(),
        closedById: "test-cashier",
      },
    });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "X", rakeSplitConfig: {} },
    });
    gameId = game.id;
  });

  it("rejects insertion of a transaction into a closed session", async () => {
    await expect(
      createTransaction({
        sessionId, gameId, type: "BUY_IN",
        createdById: "test-cashier",
        amount: new Decimal(100), method: "CASH",
        entries: [
          { account: "CASH_DRAWER", delta: new Decimal(100) },
          { account: "CHIP_FLOAT", delta: new Decimal(100) },
        ],
      })
    ).rejects.toThrow(/closed session/i);
  });
});
