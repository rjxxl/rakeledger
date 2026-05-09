import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../../test-db";
import {
  addMember,
  updateMember,
  revokeMember,
  reAddMember,
  AddMemberError,
  UpdateMemberError,
  RevokeMemberError,
} from "@/lib/admin/members";
import { provisionClub } from "@/scripts/provision-club";

describe("updateMember", () => {
  beforeEach(resetDatabase);

  it("updates the role of an existing membership", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    const added = await addMember({
      clubSlug: "x", email: "alice@x.com", name: "Alice", role: "CASHIER",
      prisma: testPrisma,
    });
    const r = await updateMember({
      membershipId: added.membership.id, name: "Alice Smith", role: "ADMIN",
      prisma: testPrisma,
    });
    expect(r.membership.role).toBe("ADMIN");
    expect(r.user.name).toBe("Alice Smith");
  });

  it("throws when the membership doesn't exist", async () => {
    await expect(
      updateMember({
        membershipId: "nonexistent", name: "X", role: "CASHIER",
        prisma: testPrisma,
      })
    ).rejects.toBeInstanceOf(UpdateMemberError);
  });
});

describe("revokeMember", () => {
  beforeEach(resetDatabase);

  it("sets status to REMOVED on a non-OWNER membership", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    const added = await addMember({
      clubSlug: "x", email: "alice@x.com", name: "Alice", role: "CASHIER",
      prisma: testPrisma,
    });
    await revokeMember({ membershipId: added.membership.id, prisma: testPrisma });
    const m = await testPrisma.clubMembership.findUnique({
      where: { id: added.membership.id },
    });
    expect(m?.status).toBe("REMOVED");
  });

  it("rejects revoking the last ACTIVE OWNER", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    const owner = await testPrisma.clubMembership.findFirstOrThrow({
      where: { role: "OWNER" },
    });
    await expect(
      revokeMember({ membershipId: owner.id, prisma: testPrisma })
    ).rejects.toBeInstanceOf(RevokeMemberError);
  });

  it("allows revoking a non-last OWNER", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    const second = await addMember({
      clubSlug: "x", email: "two@x.com", name: "Two", role: "OWNER",
      prisma: testPrisma,
    });
    await revokeMember({ membershipId: second.membership.id, prisma: testPrisma });
    const m = await testPrisma.clubMembership.findUnique({
      where: { id: second.membership.id },
    });
    expect(m?.status).toBe("REMOVED");
  });
});

describe("reAddMember", () => {
  beforeEach(resetDatabase);

  it("flips a REMOVED membership back to ACTIVE with the new role", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    const added = await addMember({
      clubSlug: "x", email: "alice@x.com", name: "Alice", role: "CASHIER",
      prisma: testPrisma,
    });
    await revokeMember({ membershipId: added.membership.id, prisma: testPrisma });
    const r = await reAddMember({
      membershipId: added.membership.id, role: "ADMIN", prisma: testPrisma,
    });
    expect(r.membership.role).toBe("ADMIN");
    expect(r.membership.status).toBe("ACTIVE");
  });
});
