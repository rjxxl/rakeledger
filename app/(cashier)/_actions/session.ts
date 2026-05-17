"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import Decimal from "decimal.js";
import { createTransaction } from "@/lib/ledger/transaction";
import { getAccountBalance } from "@/lib/ledger/balance";
import { ACCOUNTS } from "@/lib/ledger/accounts";
import { getCashierUserId } from "./_cashier";
import { getActiveClubId } from "@/lib/active-user";

export async function openSession(formData: FormData): Promise<void> {
  const openingCashRaw = formData.get("openingCash")?.toString() ?? "0";
  const openingCash = new Decimal(openingCashRaw || "0");
  const cashierId = await getCashierUserId();
  const clubId = await getActiveClubId();
  if (!clubId) {
    throw new Error(
      "Cannot open session — your account isn't a member of any club. Contact your cardroom owner to be added."
    );
  }

  const session = await prisma.session.create({
    data: {
      openedById: cashierId,
      openingCash: openingCash.toString(),
      clubId,
    },
  });

  // Auto-create a default Game so all transactions have a gameId
  const game = await prisma.game.create({
    data: {
      sessionId: session.id,
      name: process.env.SEED_DEFAULT_GAME_NAME ?? "Main Game",
      rakeSplitConfig: { type: "even" },
      clubId,
    },
  });

  // If openingCash > 0, record an OPENING_FLOAT transaction
  if (openingCash.greaterThan(0)) {
    await createTransaction({
      sessionId: session.id,
      gameId: game.id,
      type: "OPENING_FLOAT",
      createdById: cashierId,
      amount: openingCash,
      method: "CASH",
      note: "Session opening float",
      entries: [
        { account: "CASH_DRAWER", delta: openingCash },
        { account: "EXTERNAL", delta: openingCash.neg() },
      ],
    });
  }

  revalidatePath("/live");
}

export async function getOpenSession() {
  // Club-scoped: an open session in one tenant must never surface in another.
  // No active club → no session to show (matches the openSession guard).
  const clubId = await getActiveClubId();
  if (!clubId) return null;
  return await prisma.session.findFirst({
    where: { status: "OPEN", clubId },
    include: { games: true, openedBy: true },
    orderBy: { openedAt: "desc" },
  });
}

export async function closeSession(formData: FormData): Promise<void> {
  const sessionId = formData.get("sessionId")?.toString();
  if (!sessionId) throw new Error("sessionId required");

  const cashierId = await getCashierUserId();
  const GAME_SCOPED = new Set(["RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL"]);

  // Optimistic-lock: only proceed if status is still OPEN at the moment we start.
  // We freeze the session FIRST (atomic update where status = OPEN), then write account-close rows.
  // If two concurrent requests both pass the optimistic check, only one's update will succeed.
  //
  // KNOWN LIMITATION (deferred): the `getAccountBalance(...)` calls below use the global Prisma
  // singleton, not the transaction-local `tx` client. Reads happen on a different connection than
  // writes. In practice this is safe because the session is locked-and-closed in the very first
  // statement of the transaction — the closed-session trigger blocks any concurrent ledger inserts
  // after that point. But architecturally the read snapshot could miss a race in a more demanding
  // workload. Plan 1c may pass `tx` through to a transaction-aware variant of `getAccountBalance`.
  await prisma.$transaction(async (tx) => {
    const lockResult = await tx.session.updateMany({
      where: { id: sessionId, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date(), closedById: cashierId },
    });

    if (lockResult.count === 0) {
      throw new Error("Session is not open (already closed or doesn't exist)");
    }

    const session = await tx.session.findUniqueOrThrow({
      where: { id: sessionId },
      include: { games: true },
    });

    for (const account of ACCOUNTS) {
      if (GAME_SCOPED.has(account)) {
        for (const game of session.games) {
          const expected = await getAccountBalance({ account, sessionId, gameId: game.id });
          const counted = new Decimal(formData.get(`counted_${account}_${game.id}`)?.toString() ?? "0");
          const variance = counted.sub(expected);
          await tx.sessionAccountClose.create({
            data: {
              sessionId, account, gameId: game.id,
              expected: expected.toString(),
              counted: counted.toString(),
              variance: variance.toString(),
              countedById: cashierId,
            },
          });
        }
      } else {
        const expected = await getAccountBalance({ account, sessionId });
        const counted = new Decimal(formData.get(`counted_${account}`)?.toString() ?? "0");
        const variance = counted.sub(expected);
        await tx.sessionAccountClose.create({
          data: {
            sessionId, account,
            expected: expected.toString(),
            counted: counted.toString(),
            variance: variance.toString(),
            countedById: cashierId,
          },
        });
      }
    }

    await tx.session.update({
      where: { id: sessionId },
      data: { closingCash: formData.get("counted_CASH_DRAWER")?.toString() ?? "0" },
    });

    await tx.game.updateMany({
      where: { sessionId, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date() },
    });
  }, { isolationLevel: "Serializable" });

  revalidatePath("/live");
  revalidatePath("/close");
}
