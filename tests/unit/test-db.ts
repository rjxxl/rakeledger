import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL?.includes("rakeledger_test")) {
  throw new Error(
    `tests/unit/test-db.ts: DATABASE_URL is not pointing at rakeledger_test (got: ${process.env.DATABASE_URL}). ` +
    `This guard prevents tests from wiping the dev database.`
  );
}

export const testPrisma = new PrismaClient();

export async function resetDatabase() {
  await testPrisma.$executeRawUnsafe(`
    TRUNCATE
      "LedgerEntry",
      "Transaction",
      "Marker",
      "SessionAccountClose",
      "RakeDistribution",
      "CashierHandoff",
      "Game",
      "Session",
      "Table",
      "Player",
      "ClubMembership",
      "Club",
      "UserCapabilityGrant",
      "User",
      "SystemSettings"
    RESTART IDENTITY CASCADE
  `);

  // Seed a deterministic test club + cashier user + membership so tests can write
  // transactions with createdById: "test-cashier" and clubId: "test-club".
  const club = await testPrisma.club.create({
    data: { id: "test-club", name: "Test Club", slug: "test-club" },
  });
  await testPrisma.user.create({
    data: {
      id: "test-cashier",
      name: "Test Cashier",
      email: "test-cashier@dev",
      role: "CASHIER",
      clubId: club.id,
    },
  });
  await testPrisma.clubMembership.create({
    data: { userId: "test-cashier", clubId: club.id, role: "OWNER", status: "ACTIVE" },
  });
  await testPrisma.systemSettings.create({ data: { clubId: club.id } });
}
