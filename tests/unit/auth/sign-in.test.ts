import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";
import { provisionClub } from "@/scripts/provision-club";
import { addMember } from "@/lib/admin/members";

// Auth.js's `signIn` callback is exported as part of the NextAuth config in
// lib/auth.ts. It's not directly importable, but we can test the same logic
// by importing a small helper. To do that we'll extract the policy into a
// pure function `canSignIn(email, prismaClient)` that the callback calls.

import { canSignIn } from "@/lib/auth";

describe("canSignIn", () => {
  beforeEach(resetDatabase);

  it("rejects an email with no User row", async () => {
    expect(await canSignIn("nobody@x.com", testPrisma)).toBe(false);
  });

  it("rejects a User with status = DISABLED", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    await testPrisma.user.update({
      where: { email: "owner@x.com" },
      data: { status: "DISABLED" },
    });
    expect(await canSignIn("owner@x.com", testPrisma)).toBe(false);
  });

  it("rejects a User with no ACTIVE memberships", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    const m = await testPrisma.clubMembership.findFirstOrThrow({
      where: { user: { email: "owner@x.com" } },
    });
    await testPrisma.clubMembership.update({
      where: { id: m.id },
      data: { status: "REMOVED" },
    });
    expect(await canSignIn("owner@x.com", testPrisma)).toBe(false);
  });

  it("accepts a User with status=ACTIVE and at least one ACTIVE membership", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    expect(await canSignIn("owner@x.com", testPrisma)).toBe(true);
  });

  it("accepts a User with multiple memberships when at least one is ACTIVE", async () => {
    await provisionClub({
      name: "A", slug: "a", ownerEmail: "u@x.com", ownerName: "U",
      prisma: testPrisma,
    });
    await provisionClub({
      name: "B", slug: "b", ownerEmail: "owner@b.com", ownerName: "B-Owner",
      prisma: testPrisma,
    });
    await addMember({
      clubSlug: "b", email: "u@x.com", name: "U", role: "CASHIER",
      prisma: testPrisma,
    });
    // Revoke first membership, leave second active.
    const first = await testPrisma.clubMembership.findFirstOrThrow({
      where: { user: { email: "u@x.com" }, club: { slug: "a" } },
    });
    await testPrisma.clubMembership.update({
      where: { id: first.id },
      data: { status: "REMOVED" },
    });
    expect(await canSignIn("u@x.com", testPrisma)).toBe(true);
  });

  it("rejects null/empty email", async () => {
    expect(await canSignIn(null, testPrisma)).toBe(false);
    expect(await canSignIn("", testPrisma)).toBe(false);
    expect(await canSignIn(undefined, testPrisma)).toBe(false);
  });
});
