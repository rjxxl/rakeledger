import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";

describe("voided session is frozen at the DB layer", () => {
  let sessionId: string;
  let gameId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({
      data: {
        clubId: "test-club",
        openedById: "test-cashier",
        status: "VOIDED",
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

  it("the DB trigger rejects a transaction inserted into a voided session", async () => {
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
    ).rejects.toThrow(/non-open session/i);
  });
});
