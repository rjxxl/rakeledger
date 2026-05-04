import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { getAccountBalance } from "@/lib/ledger/balance";

describe("multi-game ledger", () => {
  let sessionId: string;
  let mainId: string;
  let hiStakesId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    sessionId = session.id;
    const main = await testPrisma.game.create({
      data: { sessionId, name: "Main", rakeSplitConfig: { type: "even" } },
    });
    const hi = await testPrisma.game.create({
      data: { sessionId, name: "Hi-Stakes", rakeSplitConfig: { type: "even" } },
    });
    mainId = main.id;
    hiStakesId = hi.id;
  });

  it("rake on different games does not commingle", async () => {
    await createTransaction({
      sessionId, gameId: mainId, type: "RAKE", createdById: "test-cashier",
      amount: new Decimal(50), method: "CHIPS",
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-50) },
        { account: "RAKE_POOL", delta: new Decimal(50), gameId: mainId },
      ],
    });
    await createTransaction({
      sessionId, gameId: hiStakesId, type: "RAKE", createdById: "test-cashier",
      amount: new Decimal(80), method: "CHIPS",
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-80) },
        { account: "RAKE_POOL", delta: new Decimal(80), gameId: hiStakesId },
      ],
    });

    const mainRake = await getAccountBalance({ account: "RAKE_POOL", sessionId, gameId: mainId });
    const hiRake = await getAccountBalance({ account: "RAKE_POOL", sessionId, gameId: hiStakesId });
    expect(mainRake.toString()).toBe("50");
    expect(hiRake.toString()).toBe("80");
  });

  it("chip_float is shared across games (sums to combined total)", async () => {
    await createTransaction({
      sessionId, gameId: mainId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(200), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(200) },
        { account: "CHIP_FLOAT", delta: new Decimal(200) },
      ],
    });
    await createTransaction({
      sessionId, gameId: hiStakesId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(500), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(500) },
        { account: "CHIP_FLOAT", delta: new Decimal(500) },
      ],
    });

    const float = await getAccountBalance({ account: "CHIP_FLOAT", sessionId });
    expect(float.toString()).toBe("700");
  });
});
