import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";
import { addMember, AddMemberError } from "@/scripts/add-member";
import { provisionClub } from "@/scripts/provision-club";

describe("addMember", () => {
  beforeEach(resetDatabase);

  it("adds a brand-new User to an existing Club", async () => {
    await provisionClub({
      name: "Joey's", slug: "joeys", ownerEmail: "joey@x.com", ownerName: "Joey",
      prisma: testPrisma,
    });
    const r = await addMember({
      clubSlug: "joeys", email: "alex@x.com", name: "Alex Patel", role: "CASHIER",
      prisma: testPrisma,
    });
    expect(r.user.email).toBe("alex@x.com");
    expect(r.created).toBe(true);
    expect(r.membership.role).toBe("CASHIER");
  });

  it("reuses an existing User row when the email already exists", async () => {
    await provisionClub({
      name: "Friends", slug: "friends", ownerEmail: "alex@x.com", ownerName: "Alex",
      prisma: testPrisma,
    });
    await provisionClub({
      name: "Joey's", slug: "joeys", ownerEmail: "joey@x.com", ownerName: "Joey",
      prisma: testPrisma,
    });

    const r = await addMember({
      clubSlug: "joeys", email: "alex@x.com", name: "Alex Patel", role: "CASHIER",
      prisma: testPrisma,
    });
    expect(r.created).toBe(false);
    const user = await testPrisma.user.findUnique({
      where: { email: "alex@x.com" },
      include: { memberships: true },
    });
    expect(user?.memberships).toHaveLength(2);
  });

  it("rejects adding a duplicate ACTIVE membership at the same club", async () => {
    await provisionClub({
      name: "Joey's", slug: "joeys", ownerEmail: "joey@x.com", ownerName: "Joey",
      prisma: testPrisma,
    });
    await expect(
      addMember({
        clubSlug: "joeys", email: "joey@x.com", name: "Joey", role: "OWNER",
        prisma: testPrisma,
      })
    ).rejects.toBeInstanceOf(AddMemberError);
  });

  it("rejects when the club slug doesn't exist", async () => {
    await expect(
      addMember({
        clubSlug: "nonexistent", email: "alex@x.com", name: "Alex", role: "CASHIER",
        prisma: testPrisma,
      })
    ).rejects.toBeInstanceOf(AddMemberError);
  });
});
