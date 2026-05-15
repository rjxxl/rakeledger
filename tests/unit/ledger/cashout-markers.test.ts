import { describe, it, expect, beforeEach, vi } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import {
  issueMarker,
  getOpenMarkersForPlayer,
} from "@/app/(cashier)/_actions/transactions";
import { recordCashOut } from "@/app/(cashier)/_actions/transactions";
import { getAccountBalance } from "@/lib/ledger/balance";

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.append(k, v);
  return f;
}

async function seed() {
  // resetDatabase creates club "test-club" + user "test-cashier" (OWNER).
  process.env.TEST_USER_EMAIL = "test-cashier@dev";
  const session = await testPrisma.session.create({
    data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0" },
  });
  const game = await testPrisma.game.create({
    data: { sessionId: session.id, name: "Default", rakeSplitConfig: {} },
  });
  const player = await testPrisma.player.create({
    data: { displayName: "P", clubId: "test-club" },
  });
  return { sessionId: session.id, gameId: game.id, playerId: player.id };
}

describe("getOpenMarkersForPlayer", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns OPEN markers oldest-first with serializable fields and isCurrentSession flag", async () => {
    const { sessionId, gameId, playerId } = await seed();
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "100" }));
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "50" }));

    const markers = await getOpenMarkersForPlayer(playerId, sessionId);
    expect(markers).toHaveLength(2);
    expect(markers[0].amount).toBe("100");
    expect(markers[0].remaining).toBe("100");
    expect(markers[0].isCurrentSession).toBe(true);
    expect(typeof markers[0].issuedAt).toBe("string");
    // Oldest first.
    expect(new Date(markers[0].issuedAt).getTime())
      .toBeLessThanOrEqual(new Date(markers[1].issuedAt).getTime());
  });

  it("excludes markers from other clubs", async () => {
    const { sessionId, gameId, playerId } = await seed();
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "100" }));

    await testPrisma.club.create({ data: { id: "other-club", name: "Other", slug: "other" } });
    const otherPlayer = await testPrisma.player.create({
      data: { displayName: "OP", clubId: "other-club" },
    });
    await testPrisma.marker.create({
      data: {
        playerId: otherPlayer.id,
        sessionId,
        issuedTxId: (await testPrisma.transaction.create({
          data: {
            sessionId, type: "MARKER_ISSUE", createdById: "test-cashier",
            amount: "999", method: "CHIPS", playerId: otherPlayer.id,
            ledgerEntries: { create: [
              { account: "MARKER_OUTSTANDING", delta: "999" },
              { account: "CHIP_FLOAT", delta: "999" },
            ] },
          },
        })).id,
        amount: "999", status: "OPEN", clubId: "other-club",
      },
    });

    const markers = await getOpenMarkersForPlayer(playerId, sessionId);
    expect(markers).toHaveLength(1);
    expect(markers[0].amount).toBe("100");
  });

  it("flags markers from other sessions as not current", async () => {
    const { sessionId, gameId, playerId } = await seed();
    const priorSession = await testPrisma.session.create({
      data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0" },
    });
    const priorGame = await testPrisma.game.create({
      data: { sessionId: priorSession.id, name: "Prior", rakeSplitConfig: {} },
    });
    await issueMarker(
      fd({ sessionId: priorSession.id, gameId: priorGame.id, playerId, amount: "75" })
    );

    const markers = await getOpenMarkersForPlayer(playerId, sessionId);
    expect(markers).toHaveLength(1);
    expect(markers[0].isCurrentSession).toBe(false);
    expect(markers[0].sessionId).toBe(priorSession.id);
  });
});

describe("recordCashOut marker-aware", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("NONE scope (default): single CASH_OUT, markers untouched", async () => {
    const { sessionId, gameId, playerId } = await seed();
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "100" }));
    await recordCashOut(fd({ sessionId, gameId, playerId, method: "CASH", amount: "500" }));

    const txs = await testPrisma.transaction.findMany({ where: { sessionId } });
    expect(txs.filter((t) => t.type === "CASH_OUT")).toHaveLength(1);
    expect(txs.filter((t) => t.type === "MARKER_REPAY")).toHaveLength(0);
    const marker = await testPrisma.marker.findFirst({ where: { playerId } });
    expect(marker?.status).toBe("OPEN");
    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("-500");
  });

  it("ALL scope, X > M: full CASH_OUT + MARKER_REPAY, marker REPAID, net = -(X-M)", async () => {
    const { sessionId, gameId, playerId } = await seed();
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "100" }));
    await recordCashOut(
      fd({ sessionId, gameId, playerId, method: "CASH", amount: "500", markerScope: "ALL" })
    );

    const txs = await testPrisma.transaction.findMany({ where: { sessionId } });
    expect(txs.filter((t) => t.type === "CASH_OUT")).toHaveLength(1);
    expect(txs.filter((t) => t.type === "MARKER_REPAY")).toHaveLength(1);
    const marker = await testPrisma.marker.findFirst({ where: { playerId } });
    expect(marker?.status).toBe("REPAID");
    expect(marker?.repaidAmount.toString()).toBe("100");
    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("-400");
  });

  it("ALL scope, X < M multi marker: payout 0, FIFO partial, oldest REPAID, net 0", async () => {
    const { sessionId, gameId, playerId } = await seed();
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "100" })); // oldest
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "50" }));
    await recordCashOut(
      fd({ sessionId, gameId, playerId, method: "CASH", amount: "120", markerScope: "ALL" })
    );

    const markers = await testPrisma.marker.findMany({
      where: { playerId }, orderBy: { createdAt: "asc" },
    });
    expect(markers[0].status).toBe("REPAID");
    expect(markers[0].repaidAmount.toString()).toBe("100");
    expect(markers[1].status).toBe("OPEN");
    expect(markers[1].repaidAmount.toString()).toBe("20");
    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("0");
  });

  it("TONIGHT scope ignores prior-session markers", async () => {
    const { sessionId, gameId, playerId } = await seed();
    const oldSession = await testPrisma.session.create({
      data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0" },
    });
    const oldGame = await testPrisma.game.create({
      data: { sessionId: oldSession.id, name: "Old", rakeSplitConfig: {} },
    });
    await issueMarker(fd({ sessionId: oldSession.id, gameId: oldGame.id, playerId, amount: "100" }));

    await recordCashOut(
      fd({ sessionId, gameId, playerId, method: "CASH", amount: "500", markerScope: "TONIGHT" })
    );

    const txs = await testPrisma.transaction.findMany({ where: { sessionId } });
    expect(txs.filter((t) => t.type === "MARKER_REPAY")).toHaveLength(0);
    const oldMarker = await testPrisma.marker.findFirst({ where: { sessionId: oldSession.id } });
    expect(oldMarker?.status).toBe("OPEN");
  });
});
