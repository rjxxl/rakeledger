// One-off, idempotent, STRICT ALLOW-LIST. Voids exactly the two pre-launch test
// sessions. Dry-run by default; pass --execute to write. Never deletes rows.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Hard-coded allow-list — this script can NEVER touch any other session.
const TARGETS = [
  "cmp5bng6m0005lh045s24t6et", // The Office  (currently CLOSED)
  "cmp6fr4p90001kq04ix5flcp6", // Ante Up with Gracie (currently OPEN)
];
const VOIDER_USER_ID = "cmp6aizfk0001slggyz34dwmg"; // RJ
const VOID_REASON = "VOIDED: pre-launch test session cleanup (2026-05-16)";

async function main() {
  const execute = process.argv.includes("--execute");
  console.log(execute ? "*** EXECUTE MODE — will write ***\n" : "DRY RUN (no writes). Pass --execute to apply.\n");

  for (const id of TARGETS) {
    const s = await prisma.session.findUnique({
      where: { id },
      select: { id: true, status: true, clubId: true, closedAt: true, closedById: true, notes: true,
        club: { select: { name: true } } },
    });
    if (!s) { console.log(`  MISSING  ${id} — not found, skipping`); continue; }

    const [txs, ledger, markers] = await Promise.all([
      prisma.transaction.count({ where: { sessionId: id } }),
      prisma.ledgerEntry.count({ where: { transaction: { sessionId: id } } }),
      prisma.marker.count({ where: { sessionId: id } }),
    ]);

    const newNotes = VOID_REASON + (s.notes ? ` | ${s.notes}` : "");
    const newClosedAt = s.closedAt ?? new Date();
    const newClosedById = s.closedById ?? VOIDER_USER_ID;

    console.log(`  ${s.club?.name} session ${id}`);
    console.log(`    status:     ${s.status} -> VOIDED`);
    console.log(`    closedAt:   ${s.closedAt ? "(preserved) " + s.closedAt.toISOString() : "(set) " + newClosedAt.toISOString()}`);
    console.log(`    closedById: ${s.closedById ? "(preserved) " + s.closedById : "(set) " + newClosedById}`);
    console.log(`    notes:      ${JSON.stringify(newNotes)}`);
    console.log(`    RETAINED (not deleted): transactions=${txs} ledgerEntries=${ledger} markers=${markers}`);

    if (execute) {
      await prisma.session.update({
        where: { id },
        data: { status: "VOIDED", closedAt: newClosedAt, closedById: newClosedById, notes: newNotes },
      });
      console.log(`    -> WRITTEN`);
    }
  }
  console.log(`\n${execute ? "Done (executed)." : "Dry run complete. Re-run with --execute to apply."}`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e); await prisma.$disconnect(); process.exit(1);
});
