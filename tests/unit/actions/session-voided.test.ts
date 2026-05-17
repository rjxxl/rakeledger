import { describe, it, expect, beforeEach, vi } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import { recordBuyIn } from "@/app/(cashier)/_actions/transactions";

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.append(k, v);
  return f;
}

describe("SessionStatus VOIDED enum", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("a session can be created with status VOIDED", async () => {
    const s = await testPrisma.session.create({
      data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0", status: "VOIDED" },
    });
    expect(s.status).toBe("VOIDED");
  });
});

describe("ensureSessionOpen rejects VOIDED (app guard)", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.TEST_USER_EMAIL = "test-cashier@dev";
  });

  it("recordBuyIn throws when the session is VOIDED", async () => {
    const session = await testPrisma.session.create({
      data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0", status: "VOIDED" },
    });
    const game = await testPrisma.game.create({
      data: { sessionId: session.id, name: "G", rakeSplitConfig: {} },
    });
    const player = await testPrisma.player.create({
      data: { displayName: "P", clubId: "test-club" },
    });
    await expect(
      recordBuyIn(fd({
        sessionId: session.id, gameId: game.id, playerId: player.id,
        amount: "100", method: "CASH",
      }))
    ).rejects.toThrow(/closed or voided/i);
  });
});
