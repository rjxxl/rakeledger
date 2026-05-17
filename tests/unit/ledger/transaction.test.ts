import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction, TxValidationError } from "@/lib/ledger/transaction";

describe("createTransaction", () => {
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

  it("creates a balanced buy_in with 2 ledger entries", async () => {
    const tx = await createTransaction({
      sessionId,
      gameId,
      type: "BUY_IN",
      createdById: "test-cashier",
      amount: new Decimal(200),
      method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(200) },
        { account: "CHIP_FLOAT", delta: new Decimal(200) },
      ],
    });
    expect(tx.id).toBeTruthy();
    const stored = await testPrisma.transaction.findUnique({
      where: { id: tx.id },
      include: { ledgerEntries: true },
    });
    expect(stored?.ledgerEntries.length).toBe(2);
  });

  it("rejects unbalanced entries before hitting DB", async () => {
    await expect(
      createTransaction({
        sessionId, gameId, type: "BUY_IN",
        createdById: "test-cashier",
        amount: new Decimal(200), method: "CASH",
        entries: [
          { account: "CASH_DRAWER", delta: new Decimal(200) },
          { account: "CHIP_FLOAT", delta: new Decimal(100) },
        ],
      })
    ).rejects.toThrow(TxValidationError);
  });

  it("blocks insertion into a closed session", async () => {
    await testPrisma.session.update({
      where: { id: sessionId },
      data: { status: "CLOSED", closedAt: new Date(), closedById: "test-cashier" },
    });
    await expect(
      createTransaction({
        sessionId, gameId, type: "BUY_IN",
        createdById: "test-cashier",
        amount: new Decimal(50), method: "CASH",
        entries: [
          { account: "CASH_DRAWER", delta: new Decimal(50) },
          { account: "CHIP_FLOAT", delta: new Decimal(50) },
        ],
      })
    ).rejects.toThrow(/non-open session/i);
  });
});

describe("reverseTransaction", () => {
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

  it("creates a reversal that exactly negates the original entries", async () => {
    const original = await createTransaction({
      sessionId, gameId, type: "BUY_IN",
      createdById: "test-cashier",
      amount: new Decimal(200), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(200) },
        { account: "CHIP_FLOAT", delta: new Decimal(200) },
      ],
    });

    const { reverseTransaction } = await import("@/lib/ledger/transaction");
    const reversal = await reverseTransaction({
      transactionId: original.id,
      reversedById: "test-cashier",
      reason: "test reversal",
    });

    expect(reversal.reversesId).toBe(original.id);
    const reversalEntries = await testPrisma.ledgerEntry.findMany({
      where: { transactionId: reversal.id },
    });
    expect(reversalEntries.length).toBe(2);
    expect(reversalEntries.find((e) => e.account === "CASH_DRAWER")?.delta.toString()).toBe("-200");
    expect(reversalEntries.find((e) => e.account === "CHIP_FLOAT")?.delta.toString()).toBe("-200");
  });

  it("net balance after reversal returns to zero", async () => {
    const { getAccountBalance } = await import("@/lib/ledger/balance");
    const { reverseTransaction } = await import("@/lib/ledger/transaction");

    const original = await createTransaction({
      sessionId, gameId, type: "BUY_IN",
      createdById: "test-cashier",
      amount: new Decimal(500), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(500) },
        { account: "CHIP_FLOAT", delta: new Decimal(500) },
      ],
    });
    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("500");

    await reverseTransaction({
      transactionId: original.id,
      reversedById: "test-cashier",
      reason: "test",
    });

    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("0");
  });
});
