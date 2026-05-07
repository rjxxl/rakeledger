import { PrismaClient, ClubMembershipRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Read seed config from env (with defaults that match dev expectations)
  const clubName = process.env.SEED_CLUB_NAME ?? "Dev Cardroom";
  const clubSlug = (process.env.SEED_CLUB_SLUG ?? clubName.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^-|-$/g, "");
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "cashier@dev.local";
  const ownerName = process.env.SEED_OWNER_NAME ?? "Cashier";

  // 1. Club
  const club = await prisma.club.upsert({
    where: { slug: clubSlug },
    update: { name: clubName },
    create: { name: clubName, slug: clubSlug },
  });

  // 2. Owner user
  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: { name: ownerName, status: "ACTIVE", clubId: club.id },
    create: {
      email: ownerEmail,
      name: ownerName,
      role: "CASHIER",
      status: "ACTIVE",
      clubId: club.id,
    },
  });

  // 3. Owner ClubMembership (OWNER role at this club)
  await prisma.clubMembership.upsert({
    where: { userId_clubId: { userId: owner.id, clubId: club.id } },
    update: { role: ClubMembershipRole.OWNER, status: "ACTIVE" },
    create: { userId: owner.id, clubId: club.id, role: ClubMembershipRole.OWNER, status: "ACTIVE" },
  });

  // 4. Sample staff (no logins) — only seeded in dev, skipped if SEED_SKIP_SAMPLE_STAFF=true
  if (process.env.SEED_SKIP_SAMPLE_STAFF !== "true") {
    for (const s of [
      { email: "jake@dev.local", name: "Dealer Jake", role: "DEALER" as const },
      { email: "anna@dev.local", name: "Dealer Anna", role: "DEALER" as const },
      { email: "lila@dev.local", name: "Waitress Lila", role: "WAITRESS" as const },
    ]) {
      await prisma.user.upsert({
        where: { email: s.email },
        update: { clubId: club.id },
        create: { email: s.email, name: s.name, role: s.role, status: "ACTIVE", clubId: club.id },
      });
    }
  }

  // 5. SystemSettings — one-per-club (created/updated by clubId)
  await prisma.systemSettings.upsert({
    where: { clubId: club.id },
    update: {},
    create: { clubId: club.id },
  });

  console.log(`Seed complete. Club: ${club.name} (${club.slug}). Owner: ${owner.email} (${owner.id}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
