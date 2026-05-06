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

describe("getPlayersWithUnresolvedChips", () => {
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

  async function buyIn(playerId: string, amount: number, account: "CASH_DRAWER" | "ZELLE" | "CASHAPP" = "CASH_DRAWER", method: "CASH" | "ZELLE" | "CASHAPP" = "CASH") {
    return createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(amount), method, playerId,
      entries: [
        { account, delta: new Decimal(amount) },
        { account: "CHIP_FLOAT", delta: new Decimal(amount) },
      ],
    });
  }

  async function cashOut(playerId: string, amount: number) {
    return createTransaction({
      sessionId, gameId, type: "CASH_OUT", createdById: "test-cashier",
      amount: new Decimal(amount), method: "CASH", playerId,
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(-amount) },
        { account: "CHIP_FLOAT", delta: new Decimal(-amount) },
      ],
    });
  }

  async function markerIssue(playerId: string, amount: number) {
    return createTransaction({
      sessionId, gameId, type: "MARKER_ISSUE", createdById: "test-cashier",
      amount: new Decimal(amount), method: "CHIPS", playerId,
      entries: [
        { account: "MARKER_OUTSTANDING", delta: new Decimal(amount) },
        { account: "CHIP_FLOAT", delta: new Decimal(amount) },
      ],
    });
  }

  it("includes a marker-only player who never cashed out", async () => {
    const reggie = await testPrisma.player.create({ data: { displayName: "Reggie" } });
    await markerIssue(reggie.id, 200);
    const { getPlayersWithUnresolvedChips } = await import("@/app/(cashier)/_actions/walks");
    const candidates = await getPlayersWithUnresolvedChips(sessionId);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe(reggie.id);
    expect(candidates[0].unresolvedAmount).toBe("200");
  });

  it("excludes players who fully cashed out", async () => {
    const alice = await testPrisma.player.create({ data: { displayName: "Alice" } });
    await buyIn(alice.id, 200);
    await cashOut(alice.id, 200);
    const { getPlayersWithUnresolvedChips } = await import("@/app/(cashier)/_actions/walks");
    const candidates = await getPlayersWithUnresolvedChips(sessionId);
    expect(candidates).toHaveLength(0);
  });

  it("includes a player with partial cash-out (positive remainder)", async () => {
    const yvonne = await testPrisma.player.create({ data: { displayName: "Yvonne" } });
    await buyIn(yvonne.id, 250, "CASHAPP", "CASHAPP");
    await cashOut(yvonne.id, 50);
    const { getPlayersWithUnresolvedChips } = await import("@/app/(cashier)/_actions/walks");
    const candidates = await getPlayersWithUnresolvedChips(sessionId);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe(yvonne.id);
    expect(candidates[0].unresolvedAmount).toBe("200");
  });

  it("excludes a player whose only buy-in was reversed via correction", async () => {
    const bo = await testPrisma.player.create({ data: { displayName: "Bo" } });
    const original = await buyIn(bo.id, 100);
    const { reverseTransaction } = await import("@/lib/ledger/transaction");
    await reverseTransaction({ transactionId: original.id, reversedById: "test-cashier", reason: "test" });
    const { getPlayersWithUnresolvedChips } = await import("@/app/(cashier)/_actions/walks");
    const candidates = await getPlayersWithUnresolvedChips(sessionId);
    expect(candidates).toHaveLength(0);
  });
});
