"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createTransaction } from "@/lib/ledger/transaction";
import { chipWalkSchema, chipReturnSchema } from "@/lib/validation/walks";
import { getCashierUserId } from "./_cashier";

export async function recordChipWalk(formData: FormData): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of formData.entries()) obj[k] = v.toString();
  const input = chipWalkSchema.parse(obj);
  const cashierId = await getCashierUserId();
  const amount = new Decimal(input.amount);

  // Walk: chips leave the cage's accounting universe.
  // CHIP_FLOAT (liability, sign=-1) and EXTERNAL (sign=+1) need same-sign deltas to balance:
  //   delta_chip*(-1) + delta_ext*(+1) = 0  =>  delta_chip = delta_ext
  // Both go NEGATIVE since chips are leaving (chip_float shrinks; external "loses" value to the outside).
  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "CHIP_WALK",
    createdById: cashierId,
    amount,
    method: "CHIPS",
    playerId: input.playerId,
    note: input.note ?? "Chips walked from session",
    entries: [
      { account: "CHIP_FLOAT", delta: amount.neg() },
      { account: "EXTERNAL", delta: amount.neg() },
    ],
  });

  revalidatePath("/close");
}

export async function recordChipReturn(formData: FormData): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of formData.entries()) obj[k] = v.toString();
  const input = chipReturnSchema.parse(obj);
  const cashierId = await getCashierUserId();
  const amount = new Decimal(input.amount);

  const note = input.matchesWalkId
    ? `Chips returned (matches walk tx ${input.matchesWalkId})`
    : "Chips returned (no prior walk match)";

  // Return: chips re-enter the cage's accounting. Both deltas POSITIVE (mirror of walk).
  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "CHIP_RETURN",
    createdById: cashierId,
    amount,
    method: "CHIPS",
    playerId: input.playerId,
    note,
    entries: [
      { account: "CHIP_FLOAT", delta: amount },
      { account: "EXTERNAL", delta: amount },
    ],
  });

  revalidatePath("/close");
}

export async function getPlayersWithUnresolvedChips(sessionId: string) {
  const buyIns = await prisma.transaction.findMany({
    where: { sessionId, type: "BUY_IN", playerId: { not: null } },
    select: { playerId: true },
    distinct: ["playerId"],
  });

  const players = await prisma.player.findMany({
    where: { id: { in: buyIns.map((b) => b.playerId!).filter(Boolean) } },
    orderBy: { displayName: "asc" },
  });

  return players;
}

export async function getCandidateWalksForReturn(sessionId: string) {
  const players = await prisma.transaction.findMany({
    where: { sessionId, playerId: { not: null } },
    select: { playerId: true },
    distinct: ["playerId"],
  });
  const playerIds = players.map((p) => p.playerId!).filter(Boolean);
  if (playerIds.length === 0) return [];

  const priorWalks = await prisma.transaction.findMany({
    where: {
      type: "CHIP_WALK",
      playerId: { in: playerIds },
      session: { closedAt: { not: null } },
    },
    include: { player: true, session: true },
    orderBy: { createdAt: "desc" },
  });

  return priorWalks;
}
