import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { computeTipPayouts } from "@/lib/payouts/tip-payout";

describe("computeTipPayouts", () => {
  let sessionId: string;
  let gameId: string;
  let dealerId: string;
  let waitressId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "Default", rakeSplitConfig: {} },
    });
    gameId = game.id;
    const dealer = await testPrisma.user.create({
      data: { name: "Test Dealer", role: "DEALER", tipTaxRate: null },
    });
    const waitress = await testPrisma.user.create({
      data: { name: "Test Waitress", role: "WAITRESS", tipTaxRate: "0.15" },
    });
    dealerId = dealer.id;
    waitressId = waitress.id;
    // SystemSettings.defaultTipTaxRate defaults to 0.20 in schema; the test-db seed
    // already creates the row for test-club. Nothing to set up here.
  });

  async function tipDrop(staffId: string, amount: number) {
    await createTransaction({
      sessionId, gameId, type: "TIP_DROP",
      createdById: "test-cashier",
      amount: new Decimal(amount), method: "CHIPS",
      staffId,
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-amount) },
        { account: "TIP_POOL", delta: new Decimal(amount) },
      ],
    });
  }

  it("computes default-rate payout for a dealer", async () => {
    await tipDrop(dealerId, 87);
    const rows = await computeTipPayouts(sessionId);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.total.toString()).toBe("87");
    expect(r.taxRate.toString()).toBe("0.2");
    expect(r.calculatedTax.toString()).toBe("17.4");
    expect(r.roundedTax.toString()).toBe("17");
    expect(r.netToStaff.toString()).toBe("70");
  });

  it("uses custom rate when set", async () => {
    await tipDrop(waitressId, 35);
    const rows = await computeTipPayouts(sessionId);
    expect(rows[0].taxRate.toString()).toBe("0.15");
    expect(rows[0].calculatedTax.toString()).toBe("5.25");
    expect(rows[0].roundedTax.toString()).toBe("5");
    expect(rows[0].netToStaff.toString()).toBe("30");
  });

  it("aggregates multiple drops per staff", async () => {
    await tipDrop(dealerId, 20);
    await tipDrop(dealerId, 30);
    await tipDrop(dealerId, 10);
    const rows = await computeTipPayouts(sessionId);
    expect(rows[0].total.toString()).toBe("60");
  });

  it("excludes staff with zero tip total", async () => {
    const rows = await computeTipPayouts(sessionId);
    expect(rows).toHaveLength(0);
  });
});
