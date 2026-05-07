import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";
import { provisionClub, ProvisionClubError } from "@/scripts/provision-club";

describe("provisionClub", () => {
  beforeEach(resetDatabase);

  it("creates a Club + Owner User + ClubMembership + SystemSettings", async () => {
    const result = await provisionClub({
      name: "Joey's Cardroom",
      slug: "joeys",
      ownerEmail: "joey@joeys-cardroom.com",
      ownerName: "Joey Mendoza",
      prisma: testPrisma,
    });

    expect(result.club.slug).toBe("joeys");
    expect(result.club.name).toBe("Joey's Cardroom");
    expect(result.user.email).toBe("joey@joeys-cardroom.com");
    expect(result.membership.role).toBe("OWNER");

    const settings = await testPrisma.systemSettings.findFirst({ where: { clubId: result.club.id } });
    expect(settings).not.toBeNull();
  });

  it("rejects a duplicate slug", async () => {
    await provisionClub({
      name: "Friend's", slug: "friends", ownerEmail: "f@x.com", ownerName: "F",
      prisma: testPrisma,
    });
    await expect(
      provisionClub({
        name: "Other Friends", slug: "friends", ownerEmail: "g@x.com", ownerName: "G",
        prisma: testPrisma,
      })
    ).rejects.toBeInstanceOf(ProvisionClubError);
  });

  it("rejects when an existing User has a different active membership", async () => {
    // The test User "test-cashier" already has a membership at "test-club" via the seed.
    await expect(
      provisionClub({
        name: "Other Club", slug: "other", ownerEmail: "test-cashier@dev", ownerName: "Test Cashier",
        prisma: testPrisma,
      })
    ).rejects.toBeInstanceOf(ProvisionClubError);
  });

  it("rejects an invalid slug", async () => {
    await expect(
      provisionClub({
        name: "Bad", slug: "Has Spaces", ownerEmail: "x@y.com", ownerName: "X",
        prisma: testPrisma,
      })
    ).rejects.toBeInstanceOf(ProvisionClubError);
    await expect(
      provisionClub({
        name: "Bad", slug: "-leading-hyphen", ownerEmail: "x@y.com", ownerName: "X",
        prisma: testPrisma,
      })
    ).rejects.toBeInstanceOf(ProvisionClubError);
  });
});
