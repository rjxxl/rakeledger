import { describe, it, expect, beforeEach, vi } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";

// revalidatePath requires the Next.js async-storage context (workAsyncStorage)
// which doesn't exist in unit tests. Mock next/cache so it becomes a no-op.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { updateSessionHosts } from "@/app/(cashier)/_actions/host-selection";

async function seedSession() {
  // resetDatabase already creates club "test-club" + cashier user "test-cashier"
  // (membership role OWNER). We add an active session for the cashier.
  const session = await testPrisma.session.create({
    data: {
      clubId: "test-club",
      openedById: "test-cashier",
      openingCash: "0",
    },
  });
  return session;
}

describe("updateSessionHosts", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.TEST_USER_EMAIL = "test-cashier@dev";
  });

  it("writes the userIds array to Session.hostUserIds", async () => {
    const session = await seedSession();
    // Add a second user in the same club to use as a host.
    const host = await testPrisma.user.create({
      data: {
        email: "host@x.com", name: "Host", role: "RUNNER", status: "ACTIVE", clubId: "test-club",
      },
    });
    await updateSessionHosts(session.id, [host.id]);
    const after = await testPrisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.hostUserIds).toEqual([host.id]);
  });

  it("overwrites previous selection (last-write-wins)", async () => {
    const session = await seedSession();
    const a = await testPrisma.user.create({
      data: { email: "a@x.com", name: "A", role: "RUNNER", status: "ACTIVE", clubId: "test-club" },
    });
    const b = await testPrisma.user.create({
      data: { email: "b@x.com", name: "B", role: "RUNNER", status: "ACTIVE", clubId: "test-club" },
    });
    await updateSessionHosts(session.id, [a.id]);
    await updateSessionHosts(session.id, [b.id]);
    const after = await testPrisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.hostUserIds).toEqual([b.id]);
  });

  it("rejects userIds that don't belong to the session's club", async () => {
    const session = await seedSession();
    const otherClub = await testPrisma.club.create({
      data: { name: "Other", slug: "other" },
    });
    const outsider = await testPrisma.user.create({
      data: {
        email: "outsider@x.com", name: "Outsider", role: "CASHIER", status: "ACTIVE", clubId: otherClub.id,
      },
    });
    await expect(updateSessionHosts(session.id, [outsider.id])).rejects.toThrow();
  });

  it("rejects userIds whose User.status is not ACTIVE", async () => {
    const session = await seedSession();
    const disabled = await testPrisma.user.create({
      data: {
        email: "d@x.com", name: "D", role: "RUNNER", status: "DISABLED", clubId: "test-club",
      },
    });
    await expect(updateSessionHosts(session.id, [disabled.id])).rejects.toThrow();
  });

  it("accepts an empty array (clearing selection)", async () => {
    const session = await seedSession();
    await updateSessionHosts(session.id, []);
    const after = await testPrisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.hostUserIds).toEqual([]);
  });
});
