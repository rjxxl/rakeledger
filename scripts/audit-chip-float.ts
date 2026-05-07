import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const session = await prisma.session.findFirst({
    where: { status: "OPEN" },
    include: { games: true },
  });
  if (!session) throw new Error("No open session");

  const entries = await prisma.ledgerEntry.findMany({
    where: { account: "CHIP_FLOAT", transaction: { sessionId: session.id } },
    include: { transaction: { include: { player: true } } },
    orderBy: { transaction: { createdAt: "asc" } },
  });

  let running = 0;
  console.log(`\nCHIP_FLOAT contributions for session ${session.id}:\n`);
  console.log("running   delta    type             player                  txId");
  console.log("-".repeat(95));
  for (const e of entries) {
    const delta = Number(e.delta);
    running += delta;
    const player = e.transaction.player?.displayName ?? "—";
    console.log(
      `${running.toFixed(2).padStart(8)}  ${(delta >= 0 ? "+" : "") + delta.toFixed(2)}`.padEnd(20) +
      ` ${e.transaction.type.padEnd(16)} ${player.padEnd(22)}  ${e.transaction.id.slice(0, 8)}`
    );
  }
  console.log("-".repeat(95));
  console.log(`Final CHIP_FLOAT balance: $${running.toFixed(2)}`);

  const walks = await prisma.transaction.findMany({
    where: { sessionId: session.id, type: { in: ["CHIP_WALK", "CHIP_RETURN"] } },
    include: { player: true },
  });
  console.log(`\nWalks/returns recorded: ${walks.length}`);
  for (const w of walks) {
    console.log(`  ${w.type}  ${w.player?.displayName}  $${w.amount}`);
  }
}

main().finally(() => prisma.$disconnect());
