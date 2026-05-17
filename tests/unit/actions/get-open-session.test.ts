import { describe, it, expect, beforeEach, vi } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { getOpenSession } from "@/app/(cashier)/_actions/session";

// resetDatabase seeds club "test-club" + user "test-cashier@dev" (clubId test-club).
// These tests add a SECOND club to prove getOpenSession is club-scoped and never
// leaks another tenant's open session.
async function seedOtherClub() {
  await testPrisma.club.create({ data: { id: "other-club", name: "Other", slug: "other" } });
  await testPrisma.user.create({
    data: { id: "other-user", name: "Other", email: "other@dev", role: "CASHIER", clubId: "other-club" },
  });
  await testPrisma.clubMembership.create({
    data: { userId: "other-user", clubId: "other-club", role: "OWNER", status: "ACTIVE" },
  });
}

describe("getOpenSession club scoping", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedOtherClub();
    process.env.TEST_USER_EMAIL = "test-cashier@dev";
  });

  it("returns only the active club's open session, never another club's", async () => {
    const mine = await testPrisma.session.create({
      data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0" },
    });
    await testPrisma.session.create({
      data: { clubId: "other-club", openedById: "other-user", openingCash: "0" },
    });

    const result = await getOpenSession();
    expect(result?.id).toBe(mine.id);
    expect(result?.clubId).toBe("test-club");
  });

  it("returns null when only another club has an open session (no cross-tenant leak)", async () => {
    await testPrisma.session.create({
      data: { clubId: "other-club", openedById: "other-user", openingCash: "0" },
    });

    const result = await getOpenSession();
    expect(result).toBeNull();
  });

  it("ignores a CLOSED session in the active club", async () => {
    await testPrisma.session.create({
      data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0", status: "CLOSED" },
    });

    const result = await getOpenSession();
    expect(result).toBeNull();
  });

  it("excludes a VOIDED session in the active club", async () => {
    await testPrisma.session.create({
      data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0", status: "VOIDED" },
    });
    const result = await getOpenSession();
    expect(result).toBeNull();
  });
});
