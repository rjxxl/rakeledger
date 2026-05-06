import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { correctTransaction, CorrectionError } from "@/lib/ledger/correct";
import { getAccountBalance } from "@/lib/ledger/balance";

describe("correctTransaction", () => {
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
    const player = await testPrisma.player.create({ data: { displayName: "Yvonne" } });
    playerId = player.id;
  });

  async function makeBuyIn(amount: number, methodAccount: "CASH_DRAWER" | "ZELLE" | "VENMO" | "CASHAPP" | "APPLE_PAY", method: "CASH" | "ZELLE" | "VENMO" | "CASHAPP" | "APPLE_PAY") {
    return createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(amount), method, playerId,
      entries: [
        { account: methodAccount, delta: new Decimal(amount) },
        { account: "CHIP_FLOAT", delta: new Decimal(amount) },
      ],
    });
  }

  it("changes method from CASHAPP to APPLE_PAY (the Yvonne case)", async () => {
    const tx = await makeBuyIn(250, "CASHAPP", "CASHAPP");

    expect((await getAccountBalance({ account: "CASHAPP", sessionId })).toString()).toBe("250");
    expect((await getAccountBalance({ account: "APPLE_PAY", sessionId })).toString()).toBe("0");

    await correctTransaction({
      originalId: tx.id,
      reversedById: "test-cashier",
      reason: "wrong method (cashapp → apple_pay)",
      overrides: { method: "APPLE_PAY" },
    });

    expect((await getAccountBalance({ account: "CASHAPP", sessionId })).toString()).toBe("0");
    expect((await getAccountBalance({ account: "APPLE_PAY", sessionId })).toString()).toBe("250");
    // CHIP_FLOAT unchanged: 250 (original) − 250 (reversal) + 250 (corrected) = 250
    expect((await getAccountBalance({ account: "CHIP_FLOAT", sessionId })).toString()).toBe("250");
  });

  it("changes amount from 200 to 300", async () => {
    const tx = await makeBuyIn(200, "CASH_DRAWER", "CASH");

    await correctTransaction({
      originalId: tx.id,
      reversedById: "test-cashier",
      reason: "wrong amount",
      overrides: { amount: new Decimal(300) },
    });

    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("300");
    expect((await getAccountBalance({ account: "CHIP_FLOAT", sessionId })).toString()).toBe("300");
  });

  it("changes both method and amount in a single correction", async () => {
    const tx = await makeBuyIn(200, "CASHAPP", "CASHAPP");

    await correctTransaction({
      originalId: tx.id,
      reversedById: "test-cashier",
      reason: "wrong method + amount",
      overrides: { method: "APPLE_PAY", amount: new Decimal(350) },
    });

    expect((await getAccountBalance({ account: "CASHAPP", sessionId })).toString()).toBe("0");
    expect((await getAccountBalance({ account: "APPLE_PAY", sessionId })).toString()).toBe("350");
    expect((await getAccountBalance({ account: "CHIP_FLOAT", sessionId })).toString()).toBe("350");
  });

  it("rejects correcting an already-reversed transaction", async () => {
    const tx = await makeBuyIn(100, "CASH_DRAWER", "CASH");
    await correctTransaction({
      originalId: tx.id,
      reversedById: "test-cashier",
      reason: "first correction",
      overrides: { amount: new Decimal(150) },
    });

    await expect(
      correctTransaction({
        originalId: tx.id,
        reversedById: "test-cashier",
        reason: "second attempt",
        overrides: { amount: new Decimal(200) },
      })
    ).rejects.toBeInstanceOf(CorrectionError);
  });

  it("rejects correcting a MARKER_ISSUE (excluded type)", async () => {
    const tx = await createTransaction({
      sessionId, gameId, type: "MARKER_ISSUE", createdById: "test-cashier",
      amount: new Decimal(200), method: "CHIPS", playerId,
      entries: [
        { account: "MARKER_OUTSTANDING", delta: new Decimal(200) },
        { account: "CHIP_FLOAT", delta: new Decimal(200) },
      ],
    });

    await expect(
      correctTransaction({
        originalId: tx.id,
        reversedById: "test-cashier",
        reason: "test",
        overrides: { amount: new Decimal(300) },
      })
    ).rejects.toBeInstanceOf(CorrectionError);
  });
});
