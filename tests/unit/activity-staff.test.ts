import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "./test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { getStaffSessionActivity } from "@/app/(cashier)/_actions/activity";

describe("getStaffSessionActivity", () => {
  let sessionId: string;
  let gameId: string;
  let dealerId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "Default", rakeSplitConfig: {} },
    });
    gameId = game.id;
    const dealer = await testPrisma.user.create({
      data: { email: "d1@dev.local", name: "Dealer One", role: "DEALER", status: "ACTIVE" },
    });
    dealerId = dealer.id;
  });

  async function rake(amount: number) {
    return createTransaction({
      sessionId, gameId, type: "RAKE", createdById: "test-cashier",
      amount: new Decimal(amount), method: "CHIPS", staffId: dealerId,
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-amount) },
        { account: "RAKE_POOL", delta: new Decimal(amount), gameId },
      ],
    });
  }

  async function tip(amount: number) {
    return createTransaction({
      sessionId, gameId, type: "TIP_DROP", createdById: "test-cashier",
      amount: new Decimal(amount), method: "CHIPS", staffId: dealerId,
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-amount) },
        { account: "TIP_POOL", delta: new Decimal(amount) },
      ],
    });
  }

  it("aggregates rake drops + tip drops per dealer", async () => {
    await rake(25);
    await rake(30);
    await tip(10);
    await tip(12);

    const activity = await getStaffSessionActivity(sessionId, dealerId);
    expect(activity.rows).toHaveLength(4);
    expect(activity.totals.rakeDrops).toBe("55");
    expect(activity.totals.tipDrops).toBe("22");
    expect(activity.totals.dropCount).toBe(4);
    expect(activity.totals.lastDropAt).not.toBeNull();
  });

  it("returns empty totals for staff with no activity", async () => {
    const dealer2 = await testPrisma.user.create({
      data: { email: "d2@dev.local", name: "Dealer Two", role: "DEALER", status: "ACTIVE" },
    });
    const activity = await getStaffSessionActivity(sessionId, dealer2.id);
    expect(activity.rows).toHaveLength(0);
    expect(activity.totals.rakeDrops).toBe("0");
    expect(activity.totals.tipDrops).toBe("0");
    expect(activity.totals.dropCount).toBe(0);
    expect(activity.totals.lastDropAt).toBeNull();
  });
});
