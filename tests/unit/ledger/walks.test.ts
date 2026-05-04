import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { getAccountBalance } from "@/lib/ledger/balance";

describe("chip_walk and chip_return", () => {
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
    const player = await testPrisma.player.create({ data: { displayName: "Walker" } });
    playerId = player.id;
  });

  it("chip_walk decreases chip_float and decreases external (balanced)", async () => {
    await createTransaction({
      sessionId, gameId, type: "CHIP_WALK",
      createdById: "test-cashier",
      amount: new Decimal(50), method: "CHIPS",
      playerId,
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-50) },
        { account: "EXTERNAL", delta: new Decimal(-50) },
      ],
    });
    expect((await getAccountBalance({ account: "CHIP_FLOAT", sessionId })).toString()).toBe("-50");
    expect((await getAccountBalance({ account: "EXTERNAL", sessionId })).toString()).toBe("-50");
  });

  it("chip_return reverses a walk (both balances back to zero)", async () => {
    await createTransaction({
      sessionId, gameId, type: "CHIP_WALK",
      createdById: "test-cashier",
      amount: new Decimal(50), method: "CHIPS",
      playerId,
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-50) },
        { account: "EXTERNAL", delta: new Decimal(-50) },
      ],
    });
    await createTransaction({
      sessionId, gameId, type: "CHIP_RETURN",
      createdById: "test-cashier",
      amount: new Decimal(50), method: "CHIPS",
      playerId,
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(50) },
        { account: "EXTERNAL", delta: new Decimal(50) },
      ],
    });
    expect((await getAccountBalance({ account: "CHIP_FLOAT", sessionId })).toString()).toBe("0");
    expect((await getAccountBalance({ account: "EXTERNAL", sessionId })).toString()).toBe("0");
  });
});
