"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import Decimal from "decimal.js";
import { createTransaction } from "@/lib/ledger/transaction";
import { getAccountBalance } from "@/lib/ledger/balance";
import { ACCOUNTS } from "@/lib/ledger/accounts";

const CASHIER_EMAIL = "cashier@dev.local";

async function getCashierUserId(): Promise<string> {
  const cashier = await prisma.user.findUnique({ where: { email: CASHIER_EMAIL } });
  if (!cashier) throw new Error("Cashier user not seeded — run `npx prisma db seed`");
  return cashier.id;
}

export async function openSession(formData: FormData): Promise<void> {
  const openingCashRaw = formData.get("openingCash")?.toString() ?? "0";
  const openingCash = new Decimal(openingCashRaw || "0");
  const cashierId = await getCashierUserId();

  const session = await prisma.session.create({
    data: {
      openedById: cashierId,
      openingCash: openingCash.toString(),
    },
  });

  // Auto-create a default Game so all transactions have a gameId
  const game = await prisma.game.create({
    data: {
      sessionId: session.id,
      name: "Main Game",
      rakeSplitConfig: { type: "even" },
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
  return await prisma.session.findFirst({
    where: { status: "OPEN" },
    include: { games: true, openedBy: true },
    orderBy: { openedAt: "desc" },
  });
}

export async function closeSession(formData: FormData): Promise<void> {
  const sessionId = formData.get("sessionId")?.toString();
  if (!sessionId) throw new Error("sessionId required");

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { games: true },
  });
  if (!session) throw new Error("Session not found");
  if (session.status !== "OPEN") throw new Error("Session already closed");

  const cashierId = await getCashierUserId();
  const GAME_SCOPED = new Set(["RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL"]);

  // For each account, record one SessionAccountClose row.
  // For game-scoped accounts, one row per game.
  for (const account of ACCOUNTS) {
    if (GAME_SCOPED.has(account)) {
      for (const game of session.games) {
        const expected = await getAccountBalance({ account, sessionId, gameId: game.id });
        const counted = new Decimal(formData.get(`counted_${account}_${game.id}`)?.toString() ?? "0");
        const variance = counted.sub(expected);
        await prisma.sessionAccountClose.create({
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
      await prisma.sessionAccountClose.create({
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

  // Freeze the session
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedById: cashierId,
      closingCash: formData.get("counted_CASH_DRAWER")?.toString() ?? "0",
    },
  });

  // Close any open games
  await prisma.game.updateMany({
    where: { sessionId, status: "OPEN" },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  revalidatePath("/live");
  revalidatePath("/close");
}
