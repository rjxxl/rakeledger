import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Single seeded cashier — used as the implicit user for all transactions in Plan 1
  const cashier = await prisma.user.upsert({
    where: { email: "cashier@dev.local" },
    update: {},
    create: {
      name: "Cashier",
      email: "cashier@dev.local",
      role: "CASHIER",
      status: "ACTIVE",
    },
  });

  // Sample dealers and waitresses (no logins)
  await prisma.user.upsert({
    where: { email: "jake@dev.local" },
    update: {},
    create: { name: "Dealer Jake", email: "jake@dev.local", role: "DEALER", status: "ACTIVE" },
  });
  await prisma.user.upsert({
    where: { email: "anna@dev.local" },
    update: {},
    create: { name: "Dealer Anna", email: "anna@dev.local", role: "DEALER", status: "ACTIVE" },
  });
  await prisma.user.upsert({
    where: { email: "lila@dev.local" },
    update: {},
    create: { name: "Waitress Lila", email: "lila@dev.local", role: "WAITRESS", status: "ACTIVE" },
  });

  // System settings singleton
  await prisma.systemSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  console.log(`Seed complete. Cashier id: ${cashier.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
