import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "./test-db";

describe("seed (test fixture)", () => {
  beforeEach(resetDatabase);

  it("seeds a default Club, test cashier User, and ClubMembership", async () => {
    const club = await testPrisma.club.findUnique({ where: { id: "test-club" } });
    expect(club).not.toBeNull();
    expect(club?.slug).toBe("test-club");

    const cashier = await testPrisma.user.findUnique({ where: { id: "test-cashier" } });
    expect(cashier).not.toBeNull();
    expect(cashier?.clubId).toBe("test-club");

    const membership = await testPrisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: "test-cashier", clubId: "test-club" } },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe("OWNER");

    const settings = await testPrisma.systemSettings.findUnique({ where: { clubId: "test-club" } });
    expect(settings).not.toBeNull();
  });
});
