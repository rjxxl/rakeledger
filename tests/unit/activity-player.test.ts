import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "./test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { getPlayerSessionActivity } from "@/app/(cashier)/_actions/activity";

describe("getPlayerSessionActivity", () => {
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
    const player = await testPrisma.player.create({ data: { displayName: "Alice" } });
    playerId = player.id;
  });

  it("returns rows + totals for a single player in a session", async () => {
    await createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(300), method: "CASH", playerId,
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(300) },
        { account: "CHIP_FLOAT", delta: new Decimal(300) },
      ],
    });
    await createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(200), method: "ZELLE", playerId,
      entries: [
        { account: "ZELLE", delta: new Decimal(200) },
        { account: "CHIP_FLOAT", delta: new Decimal(200) },
      ],
    });
    await createTransaction({
      sessionId, gameId, type: "CASH_OUT", createdById: "test-cashier",
      amount: new Decimal(100), method: "CASH", playerId,
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(-100) },
        { account: "CHIP_FLOAT", delta: new Decimal(-100) },
      ],
    });

    const activity = await getPlayerSessionActivity(sessionId, playerId);

    expect(activity.rows).toHaveLength(3);
    expect(activity.totals.buyIn).toBe("500");
    expect(activity.totals.cashOut).toBe("100");
    expect(activity.totals.netCash).toBe("400");
    expect(activity.totals.markersIssued).toBe("0");
    expect(activity.totals.markersRepaid).toBe("0");
  });

  it("returns empty totals for a player with no activity", async () => {
    const ghost = await testPrisma.player.create({ data: { displayName: "Ghost" } });
    const activity = await getPlayerSessionActivity(sessionId, ghost.id);
    expect(activity.rows).toHaveLength(0);
    expect(activity.totals.buyIn).toBe("0");
    expect(activity.totals.netCash).toBe("0");
  });

  it("excludes transactions from other sessions", async () => {
    const session2 = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    const game2 = await testPrisma.game.create({
      data: { sessionId: session2.id, name: "Other", rakeSplitConfig: {} },
    });
    await createTransaction({
      sessionId: session2.id, gameId: game2.id, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(999), method: "CASH", playerId,
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(999) },
        { account: "CHIP_FLOAT", delta: new Decimal(999) },
      ],
    });

    const activity = await getPlayerSessionActivity(sessionId, playerId);
    expect(activity.rows).toHaveLength(0);
  });

  it("includes reversals in rows but excludes them from totals", async () => {
    const original = await createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(100), method: "CASH", playerId,
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(100) },
        { account: "CHIP_FLOAT", delta: new Decimal(100) },
      ],
    });
    const { reverseTransaction } = await import("@/lib/ledger/transaction");
    await reverseTransaction({ transactionId: original.id, reversedById: "test-cashier", reason: "test" });

    const activity = await getPlayerSessionActivity(sessionId, playerId);
    expect(activity.rows).toHaveLength(2);
    expect(activity.totals.buyIn).toBe("100");
    expect(activity.totals.netCash).toBe("100");
  });
});
