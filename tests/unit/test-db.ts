import { PrismaClient } from "@prisma/client";

export const testPrisma = new PrismaClient();

export async function resetDatabase() {
  // Bypass append-only triggers via TRUNCATE CASCADE
  // TRUNCATE fires no BEFORE UPDATE/DELETE triggers, so append-only guards don't block it.
  // NOTE: These tests assume sole access to the local Postgres dev DB — they will
  // destructively wipe all data on every test run.
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
      "UserCapabilityGrant",
      "User"
    RESTART IDENTITY CASCADE
  `);
  // Reseed minimal user required by all tests
  await testPrisma.user.create({
    data: { id: "test-cashier", name: "Test Cashier", email: "test-cashier@dev", role: "CASHIER" },
  });
}
