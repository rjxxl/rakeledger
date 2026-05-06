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

export interface UnresolvedChipsCandidate {
  id: string;
  displayName: string;
  /** Player's net CHIP_FLOAT exposure for this session, as a stringified Decimal.
   * Positive means they have chips on the table that haven't returned to the cage. */
  unresolvedAmount: string;
}

/**
 * Returns players whose net CHIP_FLOAT delta in this session is positive — meaning
 * they put chips into play (via BUY_IN, MARKER_ISSUE, JACKPOT/FREEROLL payouts to chips,
 * etc.) that haven't come back via CASH_OUT or CHIP_WALK.
 *
 * Reversed transactions (and the originals they reversed) are excluded — their economic
 * effect was undone, so counting either side would distort the player's exposure.
 *
 * Replaces the earlier "everyone who bought in" heuristic, which (a) missed players
 * whose chips came from MARKER_ISSUE only and (b) noisily included players who already
 * fully cashed out.
 */
export async function getPlayersWithUnresolvedChips(sessionId: string): Promise<UnresolvedChipsCandidate[]> {
  const txs = await prisma.transaction.findMany({
    where: {
      sessionId,
      playerId: { not: null },
      ledgerEntries: { some: { account: "CHIP_FLOAT" } },
    },
    select: {
      id: true,
      playerId: true,
      reversesId: true,
      ledgerEntries: {
        where: { account: "CHIP_FLOAT" },
        select: { delta: true },
      },
    },
  });

  // Skip reversals AND originals that have been reversed.
  const reversedIds = new Set<string>();
  for (const t of txs) {
    if (t.reversesId) reversedIds.add(t.reversesId);
  }

  const perPlayer = new Map<string, Decimal>();
  for (const t of txs) {
    if (t.reversesId) continue;
    if (reversedIds.has(t.id)) continue;
    const delta = t.ledgerEntries.reduce(
      (sum, e) => sum.add(new Decimal(e.delta.toString())),
      new Decimal(0)
    );
    const current = perPlayer.get(t.playerId!) ?? new Decimal(0);
    perPlayer.set(t.playerId!, current.add(delta));
  }

  const candidateEntries = [...perPlayer.entries()].filter(([, sum]) => sum.greaterThan(0));
  if (candidateEntries.length === 0) return [];

  const players = await prisma.player.findMany({
    where: { id: { in: candidateEntries.map(([id]) => id) } },
    orderBy: { displayName: "asc" },
  });

  return players.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    unresolvedAmount: (perPlayer.get(p.id) ?? new Decimal(0)).toString(),
  }));
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
