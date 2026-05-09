import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../../test-db";
import { requireAdmin, NotAdminError } from "@/lib/admin/require-admin";
import { provisionClub } from "@/scripts/provision-club";
import { addMember } from "@/lib/admin/members";

// These tests bypass auth via the existing AUTH_BYPASS_FOR_TESTS=1 / TEST_USER_EMAIL pattern.
// We rotate TEST_USER_EMAIL per test to act as different members.

describe("requireAdmin", () => {
  beforeEach(resetDatabase);

  it("returns the membership when caller is OWNER", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    process.env.TEST_USER_EMAIL = "owner@x.com";
    const m = await requireAdmin();
    expect(m.role).toBe("OWNER");
  });

  it("returns the membership when caller is ADMIN", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    await addMember({
      clubSlug: "x", email: "admin@x.com", name: "Admin", role: "ADMIN",
      prisma: testPrisma,
    });
    process.env.TEST_USER_EMAIL = "admin@x.com";
    const m = await requireAdmin();
    expect(m.role).toBe("ADMIN");
  });

  it("throws NotAdminError when caller is CASHIER", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    await addMember({
      clubSlug: "x", email: "cashier@x.com", name: "Cashier", role: "CASHIER",
      prisma: testPrisma,
    });
    process.env.TEST_USER_EMAIL = "cashier@x.com";
    await expect(requireAdmin()).rejects.toBeInstanceOf(NotAdminError);
  });

  it("throws NotAdminError when caller is RUNNER", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    await addMember({
      clubSlug: "x", email: "runner@x.com", name: "Runner", role: "RUNNER",
      prisma: testPrisma,
    });
    process.env.TEST_USER_EMAIL = "runner@x.com";
    await expect(requireAdmin()).rejects.toBeInstanceOf(NotAdminError);
  });
});
