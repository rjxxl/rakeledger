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
      "UserCapabilityGrant",
      "User"
    RESTART IDENTITY CASCADE
  `);
  await testPrisma.user.create({
    data: { id: "test-cashier", name: "Test Cashier", email: "test-cashier@dev", role: "CASHIER" },
  });
}
